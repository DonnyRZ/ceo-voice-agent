-- Up Migration
CREATE OR REPLACE FUNCTION public.resend_member_registration(owner_hash text,verification_hash text)
RETURNS TABLE (id uuid,email text) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
    UPDATE app_private.member_registrations SET token_hash=verification_hash,delivery='pending',
        sent_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours',send_count=send_count+1
    WHERE claim_hash=owner_hash AND verified_at IS NULL AND expires_at>clock_timestamp()
        AND (send_count=0 OR sent_at<clock_timestamp()-interval '60 seconds') AND send_count<5
    RETURNING member_registrations.id,member_registrations.email
$$;

CREATE FUNCTION public.registration_resume_candidates(requested_email text)
RETURNS TABLE (id uuid,password_hash text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT r.id,coalesce(r.credential_hash,a.password) FROM app_private.member_registrations r
    LEFT JOIN public.account a ON a."userId"=r.legacy_user_id AND a."providerId"='credential'
    WHERE r.email=requested_email AND r.completed_at IS NULL AND r.expires_at>clock_timestamp()
        AND coalesce(r.credential_hash,a.password) IS NOT NULL
    ORDER BY r.verified_at DESC NULLS LAST,r.sent_at DESC LIMIT 5
$$;

CREATE FUNCTION public.resume_member_registration(registration_id uuid,password_hash text,owner_hash text,requested_device text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed uuid; requested_email text;
BEGIN
    SELECT email INTO requested_email FROM app_private.member_registrations WHERE id=registration_id;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email,20261128));
    UPDATE app_private.member_registrations r SET claim_hash=owner_hash,
        origin_device=coalesce(r.origin_device,requested_device)
    WHERE r.id=registration_id AND r.completed_at IS NULL AND r.expires_at>clock_timestamp()
        AND (r.credential_hash=password_hash OR (r.legacy_user_id IS NOT NULL AND EXISTS
            (SELECT FROM public.account a JOIN public.account_access access ON access.user_id=a."userId"
             WHERE a."userId"=r.legacy_user_id AND a."providerId"='credential' AND a.password=password_hash
                AND access.role='member' AND access.state='active')))
    RETURNING r.id INTO changed;
    RETURN changed IS NOT NULL;
END $$;

CREATE FUNCTION public.registration_onboarding(owner_hash text)
RETURNS TABLE (completed boolean,step text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT completed_at IS NOT NULL,onboarding_step FROM app_private.member_registrations
        WHERE claim_hash=owner_hash AND expires_at>clock_timestamp()
$$;

CREATE FUNCTION public.save_registration_step(owner_hash text,next_step text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed uuid;
BEGIN
    IF next_step NOT IN ('device','android-install','android-wait','iphone-share','iphone-add','iphone-open') THEN RETURN false; END IF;
    UPDATE app_private.member_registrations SET onboarding_step=next_step
    WHERE claim_hash=owner_hash AND verified_at IS NOT NULL AND completed_at IS NULL
        AND origin_device IS DISTINCT FROM 'desktop' AND expires_at>clock_timestamp()
    RETURNING id INTO changed;
    RETURN changed IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.registration_resume_candidates(text),public.resume_member_registration(uuid,text,text,text),
    public.registration_onboarding(text),public.save_registration_step(text,text) FROM PUBLIC;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: preserve resumable registration progress.'; END $$;
