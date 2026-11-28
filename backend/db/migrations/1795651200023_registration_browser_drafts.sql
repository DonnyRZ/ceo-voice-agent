-- Up Migration
ALTER TABLE app_private.member_registrations DROP CONSTRAINT member_registrations_email_key;
CREATE INDEX member_registration_email ON app_private.member_registrations(email);
ALTER TABLE app_private.member_registrations
    ADD COLUMN completed_at timestamptz,
    ADD COLUMN legacy_user_id text,
    ADD COLUMN onboarding_step text NOT NULL DEFAULT 'verify' CHECK (onboarding_step IN
        ('verify','device','android-install','android-wait','iphone-share','iphone-add','iphone-open','done'));
-- Preserve working accounts; only their own verified registration can resume unfinished onboarding.
UPDATE app_private.member_registrations r SET legacy_user_id=u.id,
    completed_at=CASE WHEN r.origin_device='desktop' THEN r.verified_at END,
    expires_at=CASE WHEN r.origin_device IS DISTINCT FROM 'desktop'
        THEN greatest(r.expires_at,r.verified_at+interval '7 days') ELSE r.expires_at END,
    onboarding_step=CASE WHEN r.origin_device='desktop' THEN 'done' ELSE 'device' END
FROM public."user" u JOIN public.account_access a ON a.user_id=u.id
WHERE r.email=lower(u.email) AND r.verified_at IS NOT NULL AND a.role='member';

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
    ON CONFLICT (claim_hash) DO UPDATE SET full_name = EXCLUDED.full_name, division_id = EXCLUDED.division_id,
        credential_hash = EXCLUDED.credential_hash, token_hash = EXCLUDED.token_hash, delivery = 'not_sent'
    WHERE registration.email = requested_email AND registration.verified_at IS NULL
        AND registration.send_count < 5
    RETURNING id INTO registration_id;
    RETURN registration_id;
END $$;

CREATE FUNCTION public.registration_rejection_reason(requested_email text, requested_division uuid, owner_hash text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT CASE
      WHEN NOT EXISTS (SELECT FROM public.divisions WHERE id=requested_division AND status='active') THEN 'division_unavailable'
      WHEN EXISTS (SELECT FROM app_private.member_registrations WHERE email=requested_email AND legacy_user_id IS NOT NULL
          AND completed_at IS NULL AND expires_at>clock_timestamp()) THEN 'registration_incomplete'
      WHEN EXISTS (SELECT FROM public."user" WHERE lower(email)=requested_email) THEN 'account_exists'
      WHEN EXISTS (SELECT FROM public.invitations WHERE email=requested_email AND status IN ('pending','failed') AND expires_at>clock_timestamp()) THEN 'invitation_exists'
      WHEN EXISTS (SELECT FROM app_private.member_registrations WHERE claim_hash=owner_hash AND send_count>=5) THEN 'send_limit'
      ELSE 'save_conflict' END
$$;
REVOKE ALL ON FUNCTION public.registration_rejection_reason(text, uuid, text) FROM PUBLIC;


-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: preserve registration progress and existing accounts.'; END $$;
