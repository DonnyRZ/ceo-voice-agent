-- Up Migration
ALTER TABLE public.account_access ADD COLUMN registration_complete boolean NOT NULL DEFAULT true;

CREATE FUNCTION app_private.reconcile_incomplete_registrations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET app.user_id='' AS $$
DECLARE affected text[];
BEGIN
    PERFORM pg_advisory_xact_lock(20261126,1);
    WITH changed AS (
        UPDATE public.account_access a SET registration_complete=false,version=version+1,updated_at=clock_timestamp()
        WHERE a.role='member' AND a.registration_complete AND EXISTS (
            SELECT FROM app_private.member_registrations r WHERE r.legacy_user_id=a.user_id AND r.completed_at IS NULL)
        RETURNING a.user_id
    ) SELECT array_agg(user_id) INTO affected FROM changed;
    UPDATE app_private.member_registrations SET claim_hash='retired:legacy:'||id::text
        WHERE legacy_user_id=ANY(affected) AND completed_at IS NULL;
    DELETE FROM public.session s USING public.account_access a
        WHERE s."userId"=a.user_id AND NOT a.registration_complete;
    RETURN coalesce(cardinality(affected),0);
END $$;
REVOKE ALL ON FUNCTION app_private.reconcile_incomplete_registrations() FROM PUBLIC;
SELECT app_private.reconcile_incomplete_registrations();

CREATE OR REPLACE FUNCTION app_private.member_division_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT division_id FROM public.account_access
    WHERE user_id=nullif(current_setting('app.user_id',true),'') AND role='member'
        AND state='active' AND registration_complete
$$;
CREATE OR REPLACE FUNCTION app_private.is_active_member(member_division uuid,member_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT (coalesce(member_division=(SELECT app_private.active_division_id()),false)
        OR (SELECT app_private.is_superadmin()) OR (SELECT app_private.is_ceo())) AND EXISTS (
        SELECT FROM public.account_access WHERE user_id=member_id AND division_id=member_division
            AND role='member' AND state='active' AND registration_complete)
$$;
CREATE OR REPLACE FUNCTION app_private.is_superadmin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT EXISTS(SELECT FROM public.account_access WHERE user_id=nullif(current_setting('app.user_id',true),'')
        AND role='superadmin' AND state='active' AND registration_complete)
$$;
CREATE OR REPLACE FUNCTION app_private.is_ceo() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT EXISTS(SELECT FROM public.account_access WHERE user_id=nullif(current_setting('app.user_id',true),'')
        AND role::text='ceo' AND state='active' AND registration_complete)
$$;

CREATE OR REPLACE FUNCTION app_private.guard_division_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
    IF NEW.status='archived' AND OLD.status<>'archived' AND EXISTS (
        SELECT FROM public.account_access WHERE division_id=OLD.id AND role='member'
            AND state='active' AND registration_complete) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Divisi masih memiliki anggota aktif.';
    END IF;
    RETURN NEW;
END $$;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: unfinished registration must not authenticate.'; END $$;
