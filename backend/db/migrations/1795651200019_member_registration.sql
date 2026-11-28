-- Up Migration
CREATE TABLE app_private.member_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    full_name text NOT NULL,
    division_id uuid NOT NULL REFERENCES public.divisions(id),
    credential_hash text,
    token_hash text UNIQUE,
    claim_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours',
    verified_at timestamptz,
    delivery text NOT NULL DEFAULT 'pending' CHECK (delivery IN ('pending', 'sent', 'failed')),
    sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    send_count integer NOT NULL DEFAULT 1
);
ALTER TABLE app_private.member_registrations ENABLE ROW LEVEL SECURITY;
CREATE INDEX member_registration_expiry ON app_private.member_registrations(expires_at);

CREATE TABLE app_private.registration_limits (
    bucket text PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attempts integer NOT NULL DEFAULT 1
);
ALTER TABLE app_private.registration_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX registration_limit_expiry ON app_private.registration_limits(started_at);

CREATE FUNCTION public.registration_rate_allowed(key_hash text, maximum integer, seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_attempts integer;
BEGIN
    -- Only opaque, fixed-length bucket hashes are stored; no IP addresses.
    IF length(key_hash) <> 64 OR maximum < 1 OR maximum > 100 OR seconds < 60 THEN RETURN false; END IF;
    DELETE FROM app_private.registration_limits WHERE started_at < clock_timestamp() - interval '1 day';
    INSERT INTO app_private.registration_limits AS limits (bucket) VALUES (key_hash)
    ON CONFLICT (bucket) DO UPDATE SET
        attempts = CASE WHEN limits.started_at < clock_timestamp() - make_interval(secs => seconds)
            THEN 1 ELSE limits.attempts + 1 END,
        started_at = CASE WHEN limits.started_at < clock_timestamp() - make_interval(secs => seconds)
            THEN clock_timestamp() ELSE limits.started_at END
    RETURNING attempts INTO current_attempts;
    RETURN current_attempts <= maximum;
END $$;

CREATE FUNCTION public.registration_divisions() RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT division.id, division.name FROM public.divisions division
    WHERE division.status = 'active' ORDER BY division.name
$$;

CREATE FUNCTION public.registration_status(owner_hash text)
RETURNS TABLE (name text, email text, division_id uuid, verified boolean, delivery text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT full_name, registration.email, registration.division_id, verified_at IS NOT NULL, registration.delivery
    FROM app_private.member_registrations registration
    WHERE claim_hash = owner_hash AND expires_at > clock_timestamp()
$$;

CREATE FUNCTION public.save_member_registration(
    requested_email text, requested_name text, requested_division uuid,
    password_hash text, verification_hash text, owner_hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE registration_id uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email, 20261128));
    PERFORM 1 FROM public.divisions WHERE id = requested_division AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF EXISTS (SELECT FROM public."user" WHERE lower(email) = requested_email)
        OR EXISTS (SELECT FROM public.invitations WHERE email = requested_email AND status IN ('pending', 'failed')
            AND expires_at > clock_timestamp()) THEN RETURN NULL; END IF;

    -- Remove expired credentials and owner claims, retaining no pending password indefinitely.
    DELETE FROM app_private.member_registrations WHERE expires_at <= clock_timestamp();
    INSERT INTO app_private.member_registrations AS registration
        (email, full_name, division_id, credential_hash, token_hash, claim_hash)
    VALUES (requested_email, requested_name, requested_division, password_hash, verification_hash, owner_hash)
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, division_id = EXCLUDED.division_id,
        credential_hash = EXCLUDED.credential_hash, token_hash = EXCLUDED.token_hash,
        delivery = 'pending', sent_at = clock_timestamp(), send_count = registration.send_count + 1
    WHERE registration.claim_hash = owner_hash AND registration.verified_at IS NULL
        AND registration.sent_at < clock_timestamp() - interval '60 seconds' AND registration.send_count < 5
    RETURNING id INTO registration_id;
    RETURN registration_id;
END $$;

CREATE FUNCTION public.resend_member_registration(owner_hash text, verification_hash text)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    UPDATE app_private.member_registrations SET token_hash = verification_hash, delivery = 'pending',
        sent_at = clock_timestamp(), send_count = send_count + 1
    WHERE claim_hash = owner_hash AND verified_at IS NULL AND expires_at > clock_timestamp()
        AND sent_at < clock_timestamp() - interval '60 seconds' AND send_count < 5
    RETURNING member_registrations.id, member_registrations.email
$$;

CREATE FUNCTION public.member_registration_delivery(registration_id uuid, verification_hash text, outcome text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    UPDATE app_private.member_registrations SET delivery = outcome
    WHERE id = registration_id AND token_hash = verification_hash AND verified_at IS NULL
        AND outcome IN ('sent', 'failed')
$$;

REVOKE ALL ON FUNCTION public.registration_rate_allowed(text, integer, integer),
    public.registration_divisions(), public.registration_status(text),
    public.save_member_registration(text, text, uuid, text, text, text),
    public.resend_member_registration(text, text), public.member_registration_delivery(uuid, text, text) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.member_registration_delivery(uuid, text, text);
DROP FUNCTION public.resend_member_registration(text, text);
DROP FUNCTION public.save_member_registration(text, text, uuid, text, text, text);
DROP FUNCTION public.registration_status(text);
DROP FUNCTION public.registration_divisions();
DROP FUNCTION public.registration_rate_allowed(text, integer, integer);
DROP TABLE app_private.registration_limits;
DROP TABLE app_private.member_registrations;
