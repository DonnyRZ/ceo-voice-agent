-- Up Migration
CREATE FUNCTION app_private.verify_registration_recovery(ticket_id uuid,new_user_id text,new_account_id text,owner_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ticket app_private.member_registrations%ROWTYPE; target app_private.member_registrations%ROWTYPE; result text;
BEGIN
    SELECT * INTO ticket FROM app_private.member_registrations WHERE id=ticket_id FOR UPDATE;
    IF ticket.claim_hash IS DISTINCT FROM owner_hash OR ticket.verified_at IS NOT NULL OR ticket.expires_at<=clock_timestamp()
        OR ticket.recovery_target_id IS DISTINCT FROM app_private.registration_recovery_target(ticket.email)
        OR ticket.credential_hash IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO target FROM app_private.member_registrations WHERE id=ticket.recovery_target_id FOR UPDATE;
    PERFORM 1 FROM public.divisions WHERE id=target.division_id AND status='active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- Release the requesting capability before transferring it; old browser claims become invalid.
    UPDATE app_private.member_registrations SET claim_hash='retired:'||id::text,token_hash=NULL,
        credential_hash=NULL,verified_at=clock_timestamp(),completed_at=clock_timestamp(),expires_at=clock_timestamp()
        WHERE id=ticket.id;
    UPDATE app_private.member_registrations SET claim_hash=ticket.claim_hash,
        credential_hash=ticket.credential_hash,credential_recovery_verified_at=clock_timestamp(),
        origin_device=coalesce(target.origin_device,ticket.origin_device),expires_at=clock_timestamp()+interval '7 days',
        onboarding_step=CASE WHEN target.onboarding_step='verify' THEN 'device' ELSE target.onboarding_step END
        WHERE id=target.id;
    IF coalesce(target.origin_device,ticket.origin_device)='desktop' THEN
        result:=public.complete_member_registration(ticket.claim_hash,new_user_id,new_account_id);
        IF result IS NULL THEN RAISE EXCEPTION 'Registration recovery completion failed'; END IF;
    END IF;
    RETURN target.email;
END $$;
REVOKE ALL ON FUNCTION app_private.verify_registration_recovery(uuid,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.registration_requires_original_browser(verification_hash text,owner_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT EXISTS(SELECT FROM app_private.member_registrations WHERE token_hash=verification_hash
        AND verified_at IS NULL AND expires_at>clock_timestamp() AND recovery_target_id IS NOT NULL
        AND claim_hash IS DISTINCT FROM owner_hash)
$$;
REVOKE ALL ON FUNCTION public.registration_requires_original_browser(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.verify_member_registration(verification_hash text,new_user_id text,new_account_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app_private.member_registrations%ROWTYPE; requested_email text; result text;
BEGIN
    SELECT email INTO requested_email FROM app_private.member_registrations
        WHERE token_hash=verification_hash AND verified_at IS NULL AND expires_at>clock_timestamp();
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email,20261128));
    SELECT * INTO r FROM app_private.member_registrations WHERE token_hash=verification_hash FOR UPDATE;
    IF NOT FOUND OR r.verified_at IS NOT NULL OR r.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
    IF r.recovery_target_id IS NOT NULL THEN
        RETURN NULL; -- Recovery requires the requesting capability through confirm_member_registration.
    END IF;
    PERFORM 1 FROM public.divisions WHERE id=r.division_id AND status='active' FOR SHARE;
    IF NOT FOUND OR EXISTS (SELECT FROM public."user" WHERE lower(email)=r.email)
        OR EXISTS (SELECT FROM public.invitations WHERE email=r.email AND status IN ('pending','failed')
            AND expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
    UPDATE app_private.member_registrations SET verified_at=clock_timestamp(),token_hash=NULL,
        expires_at=clock_timestamp()+interval '7 days',onboarding_step='device' WHERE id=r.id;
    IF r.origin_device='desktop' THEN
        result:=public.complete_member_registration(r.claim_hash,new_user_id,new_account_id);
        IF result IS NULL THEN RAISE EXCEPTION 'Registration completion failed'; END IF;
    END IF;
    RETURN r.email;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_member_registration(
    verification_hash text,new_user_id text,new_account_id text,owner_hash text
) RETURNS TABLE (email text,origin_device text,same_browser boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE verified_email text; verified_id uuid; ticket app_private.member_registrations%ROWTYPE;
BEGIN
    SELECT * INTO ticket FROM app_private.member_registrations WHERE token_hash=verification_hash;
    IF NOT FOUND THEN RETURN; END IF;
    verified_id:=coalesce(ticket.recovery_target_id,ticket.id);
    IF ticket.recovery_target_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(ticket.email,20261128));
        SELECT * INTO ticket FROM app_private.member_registrations WHERE token_hash=verification_hash FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        verified_email:=app_private.verify_registration_recovery(ticket.id,new_user_id,new_account_id,owner_hash);
    ELSE
        verified_email:=public.verify_member_registration(verification_hash,new_user_id,new_account_id);
    END IF;
    IF verified_email IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT r.email,r.origin_device,coalesce(r.claim_hash=owner_hash,false)
        FROM app_private.member_registrations r WHERE r.id=verified_id;
END $$;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: email proof must protect progress recovery.'; END $$;
