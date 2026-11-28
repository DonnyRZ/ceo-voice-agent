-- Up Migration
ALTER TABLE app_private.member_registrations
    ADD COLUMN recovery_target_id uuid REFERENCES app_private.member_registrations(id),
    ADD COLUMN credential_recovery_verified_at timestamptz;

CREATE FUNCTION app_private.registration_recovery_target(requested_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT r.id FROM app_private.member_registrations r
    JOIN public.account_access a ON a.user_id=r.legacy_user_id
    JOIN public."user" u ON u.id=a.user_id AND lower(u.email)=r.email
    WHERE r.email=requested_email AND r.completed_at IS NULL AND r.recovery_target_id IS NULL
        AND a.role='member' AND a.state='active' AND NOT a.registration_complete
    ORDER BY r.verified_at DESC NULLS LAST,r.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION app_private.registration_recovery_target(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.save_member_registration(
    requested_email text,requested_name text,requested_division uuid,
    password_hash text,verification_hash text,owner_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE registration_id uuid; recovery_target uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email,20261128));
    PERFORM 1 FROM public.divisions WHERE id=requested_division AND status='active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    recovery_target:=app_private.registration_recovery_target(requested_email);
    IF (recovery_target IS NULL AND EXISTS (SELECT FROM public."user" WHERE lower(email)=requested_email))
        OR EXISTS (SELECT FROM public.invitations WHERE email=requested_email AND status IN ('pending','failed')
            AND expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
    DELETE FROM app_private.member_registrations WHERE expires_at<=clock_timestamp() AND recovery_target_id IS NOT NULL;
    DELETE FROM app_private.member_registrations WHERE expires_at<=clock_timestamp()
        AND legacy_user_id IS NULL AND recovery_target_id IS NULL
        AND id NOT IN (SELECT recovery_target_id FROM app_private.member_registrations WHERE recovery_target_id IS NOT NULL);
    INSERT INTO app_private.member_registrations AS registration
        (email,full_name,division_id,credential_hash,token_hash,claim_hash,recovery_target_id)
    VALUES (requested_email,requested_name,requested_division,password_hash,verification_hash,owner_hash,recovery_target)
    ON CONFLICT (claim_hash) DO UPDATE SET full_name=EXCLUDED.full_name,division_id=EXCLUDED.division_id,
        credential_hash=EXCLUDED.credential_hash,token_hash=EXCLUDED.token_hash,delivery='not_sent'
    WHERE registration.email=requested_email AND registration.verified_at IS NULL AND registration.send_count<5
    RETURNING id INTO registration_id;
    RETURN registration_id;
END $$;

CREATE OR REPLACE FUNCTION public.registration_rejection_reason(requested_email text,requested_division uuid,owner_hash text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT CASE
      WHEN NOT EXISTS(SELECT FROM public.divisions WHERE id=requested_division AND status='active') THEN 'division_unavailable'
      WHEN EXISTS(SELECT FROM public."user" u JOIN public.account_access a ON a.user_id=u.id
          WHERE lower(u.email)=requested_email AND a.state='revoked') THEN 'account_inactive'
      WHEN EXISTS(SELECT FROM public."user" u JOIN public.account_access a ON a.user_id=u.id
          WHERE lower(u.email)=requested_email AND NOT a.registration_complete) THEN 'recovery_unavailable'
      WHEN EXISTS(SELECT FROM public."user" WHERE lower(email)=requested_email) THEN 'account_exists'
      WHEN EXISTS(SELECT FROM public.invitations WHERE email=requested_email AND status IN ('pending','failed')
          AND expires_at>clock_timestamp()) THEN 'invitation_exists'
      WHEN EXISTS(SELECT FROM app_private.member_registrations WHERE claim_hash=owner_hash AND send_count>=5) THEN 'send_limit'
      ELSE 'save_conflict' END
$$;

DROP FUNCTION public.registration_resume_candidates(text);
CREATE FUNCTION public.registration_resume_candidates(requested_email text)
RETURNS TABLE (id uuid,password_hash text,legacy boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT r.id,coalesce(r.credential_hash,a.password),r.legacy_user_id IS NOT NULL FROM app_private.member_registrations r
    LEFT JOIN public.account a ON a."userId"=r.legacy_user_id AND a."providerId"='credential'
    WHERE r.email=requested_email AND r.completed_at IS NULL AND r.expires_at>clock_timestamp()
        AND coalesce(r.credential_hash,a.password) IS NOT NULL
    ORDER BY r.verified_at DESC NULLS LAST,r.sent_at DESC LIMIT 5
$$;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: email ownership recovery must remain available.'; END $$;
