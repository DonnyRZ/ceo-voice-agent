-- Up Migration
CREATE FUNCTION public.retire_registration_draft(owner_hash text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    UPDATE app_private.member_registrations
    SET expires_at = least(expires_at, clock_timestamp()), credential_hash = NULL, token_hash = NULL
    WHERE claim_hash = owner_hash AND verified_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.retire_registration_draft(text) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.retire_registration_draft(text);
