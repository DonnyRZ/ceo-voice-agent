-- Up Migration
CREATE FUNCTION public.complete_member_registration(owner_hash text, new_user_id text, new_account_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET app.user_id='' AS $$
DECLARE r app_private.member_registrations%ROWTYPE; requested_email text; inserted_id text;
BEGIN
    SELECT email INTO requested_email FROM app_private.member_registrations WHERE claim_hash=owner_hash;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email,20261128));
    SELECT * INTO r FROM app_private.member_registrations WHERE claim_hash=owner_hash FOR UPDATE;
    IF r.verified_at IS NULL OR r.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
    IF r.completed_at IS NOT NULL THEN RETURN r.email; END IF;
    IF r.origin_device IS DISTINCT FROM 'desktop' AND r.onboarding_step NOT IN
        ('android-install','android-wait','iphone-open','done') THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.divisions WHERE id=r.division_id AND status='active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF r.legacy_user_id IS NOT NULL THEN
        -- Existing accounts are never reset, moved to another division, or recreated by onboarding.
        IF NOT EXISTS (SELECT FROM public.account_access WHERE user_id=r.legacy_user_id AND role='member' AND state='active')
            THEN RETURN NULL; END IF;
    ELSE
        IF r.credential_hash IS NULL OR EXISTS (SELECT FROM public.invitations WHERE email=r.email
            AND status IN ('pending','failed') AND expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
        INSERT INTO public."user" (id,name,email,"emailVerified") VALUES (new_user_id,r.full_name,r.email,true)
            ON CONFLICT (email) DO NOTHING RETURNING id INTO inserted_id;
        IF inserted_id IS NULL THEN RETURN NULL; END IF;
        PERFORM set_config('app.user_id',inserted_id,true);
        INSERT INTO public.account (id,"accountId","providerId","userId",password)
            VALUES (new_account_id,inserted_id,'credential',inserted_id,r.credential_hash);
        INSERT INTO public.account_access (user_id,role,division_id) VALUES (inserted_id,'member',r.division_id);
        INSERT INTO public.members (id,division_id,name) VALUES (inserted_id,r.division_id,r.full_name);
    END IF;
    UPDATE app_private.member_registrations SET completed_at=clock_timestamp(),onboarding_step='done',
        credential_hash=NULL,token_hash=NULL WHERE id=r.id;
    UPDATE app_private.member_registrations SET expires_at=least(expires_at,clock_timestamp()),credential_hash=NULL,token_hash=NULL
        WHERE email=r.email AND id<>r.id AND completed_at IS NULL;
    RETURN r.email;
END $$;

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
DECLARE verified_email text; verified_id uuid;
BEGIN
    SELECT id INTO verified_id FROM app_private.member_registrations WHERE token_hash=verification_hash;
    verified_email:=public.verify_member_registration(verification_hash,new_user_id,new_account_id);
    IF verified_email IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT r.email,r.origin_device,coalesce(r.claim_hash=owner_hash,false)
        FROM app_private.member_registrations r WHERE r.id=verified_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_member_registration(text,text,text) FROM PUBLIC;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: accounts must activate after onboarding completion.'; END $$;
