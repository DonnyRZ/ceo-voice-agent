-- Up Migration
CREATE OR REPLACE FUNCTION public.complete_member_registration(owner_hash text,new_user_id text,new_account_id text)
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
        PERFORM 1 FROM public.account_access WHERE user_id=r.legacy_user_id AND role='member'
            AND state='active' AND NOT registration_complete AND division_id=r.division_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF r.credential_recovery_verified_at IS NOT NULL AND r.credential_hash IS NOT NULL THEN
            UPDATE public.account SET password=r.credential_hash,"updatedAt"=clock_timestamp()
                WHERE "userId"=r.legacy_user_id AND "providerId"='credential';
            IF NOT FOUND THEN RETURN NULL; END IF;
            DELETE FROM public.session WHERE "userId"=r.legacy_user_id;
        END IF;
        UPDATE public.account_access SET registration_complete=true,version=version+1,updated_at=clock_timestamp()
            WHERE user_id=r.legacy_user_id AND NOT registration_complete;
    ELSE
        IF r.credential_hash IS NULL OR EXISTS (SELECT FROM public.invitations WHERE email=r.email
            AND status IN ('pending','failed') AND expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
        INSERT INTO public."user"(id,name,email,"emailVerified") VALUES(new_user_id,r.full_name,r.email,true)
            ON CONFLICT(email) DO NOTHING RETURNING id INTO inserted_id;
        IF inserted_id IS NULL THEN RETURN NULL; END IF;
        PERFORM set_config('app.user_id',inserted_id,true);
        INSERT INTO public.account(id,"accountId","providerId","userId",password)
            VALUES(new_account_id,inserted_id,'credential',inserted_id,r.credential_hash);
        INSERT INTO public.account_access(user_id,role,division_id) VALUES(inserted_id,'member',r.division_id);
        INSERT INTO public.members(id,division_id,name) VALUES(inserted_id,r.division_id,r.full_name);
    END IF;
    UPDATE app_private.member_registrations SET completed_at=clock_timestamp(),onboarding_step='done',
        credential_hash=NULL,token_hash=NULL,credential_recovery_verified_at=NULL WHERE id=r.id;
    UPDATE app_private.member_registrations SET expires_at=least(expires_at,clock_timestamp()),credential_hash=NULL,token_hash=NULL
        WHERE email=r.email AND id<>r.id AND completed_at IS NULL;
    RETURN r.email;
END $$;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: activate recovered accounts only on final completion.'; END $$;
