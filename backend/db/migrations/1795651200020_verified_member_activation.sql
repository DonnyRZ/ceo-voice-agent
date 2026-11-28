-- Up Migration
CREATE FUNCTION public.verify_member_registration(verification_hash text, new_user_id text, new_account_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET app.user_id = '' AS $$
DECLARE
    registration app_private.member_registrations%ROWTYPE;
    requested_email text;
    inserted_id text;
    target_division uuid;
BEGIN
    SELECT email, division_id INTO requested_email, target_division FROM app_private.member_registrations
    WHERE token_hash = verification_hash AND verified_at IS NULL AND expires_at > clock_timestamp();
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email, 20261128));
    PERFORM 1 FROM public.divisions WHERE id = target_division AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO registration FROM app_private.member_registrations
    WHERE token_hash = verification_hash FOR UPDATE;
    IF NOT FOUND OR registration.verified_at IS NOT NULL OR registration.expires_at <= clock_timestamp()
        OR registration.division_id IS DISTINCT FROM target_division THEN RETURN NULL; END IF;
    -- An invitation reserved by Superadmin must be completed through its own activation flow.
    IF EXISTS (SELECT FROM public.invitations WHERE email = registration.email AND status IN ('pending', 'failed')
        AND expires_at > clock_timestamp()) THEN RETURN NULL; END IF;
    INSERT INTO public."user" (id, name, email, "emailVerified")
    VALUES (new_user_id, registration.full_name, registration.email, true)
    ON CONFLICT (email) DO NOTHING RETURNING id INTO inserted_id;
    IF inserted_id IS NULL THEN RETURN NULL; END IF;
    PERFORM set_config('app.user_id', inserted_id, true);
    INSERT INTO public.account (id, "accountId", "providerId", "userId", password)
    VALUES (new_account_id, inserted_id, 'credential', inserted_id, registration.credential_hash);
    -- Role is a server-side constant, never an argument from public registration.
    INSERT INTO public.account_access (user_id, role, division_id) VALUES (inserted_id, 'member', target_division);
    INSERT INTO public.members (id, division_id, name) VALUES (inserted_id, target_division, registration.full_name);
    UPDATE app_private.member_registrations SET verified_at = clock_timestamp(),
        credential_hash = NULL, token_hash = NULL WHERE id = registration.id;
    RETURN registration.email;
END $$;
REVOKE ALL ON FUNCTION public.verify_member_registration(text, text, text) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.verify_member_registration(text, text, text);
