-- Up Migration
ALTER TABLE app_private.member_registrations ADD COLUMN origin_device text
    CHECK (origin_device IN ('mobile', 'desktop'));
ALTER TABLE app_private.member_registrations DROP CONSTRAINT member_registrations_delivery_check;
ALTER TABLE app_private.member_registrations ADD CONSTRAINT member_registrations_delivery_check
    CHECK (delivery IN ('not_sent', 'pending', 'sent', 'failed'));
ALTER TABLE app_private.member_registrations ALTER COLUMN delivery SET DEFAULT 'not_sent';
ALTER TABLE app_private.member_registrations ALTER COLUMN send_count SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.save_member_registration(
    requested_email text, requested_name text, requested_division uuid,
    password_hash text, verification_hash text, owner_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE registration_id uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email, 20261128));
    PERFORM 1 FROM public.divisions WHERE id = requested_division AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF EXISTS (SELECT FROM public."user" WHERE lower(email) = requested_email)
        OR EXISTS (SELECT FROM public.invitations WHERE email = requested_email AND status IN ('pending', 'failed')
            AND expires_at > clock_timestamp()) THEN RETURN NULL; END IF;
    DELETE FROM app_private.member_registrations WHERE expires_at <= clock_timestamp();
    INSERT INTO app_private.member_registrations AS registration
        (email, full_name, division_id, credential_hash, token_hash, claim_hash)
    VALUES (requested_email, requested_name, requested_division, password_hash, verification_hash, owner_hash)
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, division_id = EXCLUDED.division_id,
        credential_hash = EXCLUDED.credential_hash, token_hash = EXCLUDED.token_hash, delivery = 'not_sent'
    WHERE registration.claim_hash = owner_hash AND registration.verified_at IS NULL
        AND (registration.send_count = 0 OR registration.sent_at < clock_timestamp() - interval '60 seconds')
        AND registration.send_count < 5
    RETURNING id INTO registration_id;
    RETURN registration_id;
END $$;

CREATE FUNCTION public.capture_registration_origin(owner_hash text, device text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    UPDATE app_private.member_registrations SET origin_device = device
    WHERE claim_hash = owner_hash AND origin_device IS NULL AND device IN ('mobile', 'desktop')
        AND verified_at IS NULL AND expires_at > clock_timestamp()
$$;

CREATE FUNCTION public.registration_context(owner_hash text)
RETURNS TABLE (origin_device text, resend_after timestamptz, sends_remaining integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT registration.origin_device,
        CASE WHEN send_count > 0 THEN sent_at + interval '60 seconds' ELSE NULL END,
        greatest(0, 5 - send_count)
    FROM app_private.member_registrations registration
    WHERE claim_hash = owner_hash AND expires_at > clock_timestamp()
$$;

CREATE OR REPLACE FUNCTION public.resend_member_registration(owner_hash text, verification_hash text)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    UPDATE app_private.member_registrations SET token_hash = verification_hash, delivery = 'pending',
        sent_at = clock_timestamp(), send_count = send_count + 1
    WHERE claim_hash = owner_hash AND verified_at IS NULL AND expires_at > clock_timestamp()
        AND (send_count = 0 OR sent_at < clock_timestamp() - interval '60 seconds') AND send_count < 5
    RETURNING member_registrations.id, member_registrations.email
$$;

CREATE FUNCTION public.confirm_member_registration(
    verification_hash text, new_user_id text, new_account_id text, owner_hash text
) RETURNS TABLE (email text, origin_device text, same_browser boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE verified_email text;
BEGIN
    verified_email := public.verify_member_registration(verification_hash, new_user_id, new_account_id);
    IF verified_email IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT registration.email, registration.origin_device,
        coalesce(registration.claim_hash = owner_hash, false)
    FROM app_private.member_registrations registration WHERE registration.email = verified_email;
END $$;
REVOKE ALL ON FUNCTION public.capture_registration_origin(text, text),
    public.registration_context(text), public.confirm_member_registration(text, text, text, text) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.confirm_member_registration(text, text, text, text);
DROP FUNCTION public.registration_context(text);
DROP FUNCTION public.capture_registration_origin(text, text);
ALTER TABLE app_private.member_registrations DROP COLUMN origin_device;
-- Email records and their current states are preserved on application rollback.
