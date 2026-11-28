-- Up Migration
CREATE FUNCTION public.registration_verification_context(verification_hash text,owner_hash text)
RETURNS TABLE (requires_password boolean,password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT r.recovery_target_id IS NOT NULL AND r.claim_hash IS DISTINCT FROM owner_hash,
        CASE WHEN r.recovery_target_id IS NOT NULL THEN r.credential_hash END
    FROM app_private.member_registrations r
    WHERE r.token_hash=verification_hash AND r.verified_at IS NULL AND r.expires_at>clock_timestamp()
$$;

CREATE FUNCTION public.confirm_registration_with_password(
    verification_hash text,expected_password_hash text,new_user_id text,new_account_id text,caller_hash text
) RETURNS TABLE (email text,origin_device text,same_browser boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ticket app_private.member_registrations%ROWTYPE; requested_email text;
BEGIN
    SELECT r.email INTO requested_email FROM app_private.member_registrations r WHERE r.token_hash=verification_hash;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_email,20261128));
    SELECT * INTO ticket FROM app_private.member_registrations r WHERE r.token_hash=verification_hash FOR UPDATE;
    IF NOT FOUND OR ticket.verified_at IS NOT NULL OR ticket.expires_at<=clock_timestamp()
        OR ticket.recovery_target_id IS NULL OR ticket.credential_hash IS DISTINCT FROM expected_password_hash
        OR expected_password_hash IS NULL THEN RETURN; END IF;
    -- The API has verified the supplied password. Recheck its exact hash under the
    -- same lock as token consumption so an edited draft cannot race that proof.
    RETURN QUERY SELECT v.email,v.origin_device,coalesce(ticket.claim_hash=caller_hash,false)
        FROM public.confirm_member_registration(verification_hash,new_user_id,new_account_id,ticket.claim_hash) v;
END $$;

REVOKE ALL ON FUNCTION public.registration_verification_context(text,text),
    public.confirm_registration_with_password(text,text,text,text,text) FROM PUBLIC;

-- Keep the previous release's SQL ABI during blue-green drain, with its restriction
-- removed. The current API never calls this inert compatibility entry point.
CREATE OR REPLACE FUNCTION public.registration_requires_original_browser(verification_hash text,owner_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT false $$;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: preserve cross-browser email verification.'; END $$;
