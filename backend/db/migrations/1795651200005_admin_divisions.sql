-- Up Migration
ALTER TABLE public.divisions
    ADD COLUMN code text NOT NULL DEFAULT upper(left(replace(gen_random_uuid()::text, '-', ''), 12)),
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX divisions_code_unique ON public.divisions (lower(code));

CREATE POLICY divisions_admin_insert ON public.divisions FOR INSERT
    WITH CHECK ((SELECT app_private.is_superadmin()));

CREATE POLICY divisions_admin_update ON public.divisions FOR UPDATE
    USING ((SELECT app_private.is_superadmin()))
    WITH CHECK ((SELECT app_private.is_superadmin()));

-- Also protect archive operations issued outside the route. Account assignments
-- lock the same division before permitting a new active member.
CREATE FUNCTION app_private.guard_division_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.status = 'archived' AND OLD.status <> 'archived' AND EXISTS (
        SELECT 1 FROM public.account_access
        WHERE division_id = OLD.id AND role = 'member' AND state = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Divisi masih memiliki anggota aktif.';
    END IF;
    RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app_private.guard_division_archive() FROM PUBLIC;

CREATE TRIGGER guard_division_archive BEFORE UPDATE OF status ON public.divisions
    FOR EACH ROW EXECUTE FUNCTION app_private.guard_division_archive();

-- Down Migration
DROP TRIGGER guard_division_archive ON public.divisions;
DROP FUNCTION app_private.guard_division_archive();
DROP POLICY divisions_admin_update ON public.divisions;
DROP POLICY divisions_admin_insert ON public.divisions;
DROP INDEX public.divisions_code_unique;
ALTER TABLE public.divisions DROP COLUMN updated_at, DROP COLUMN version,
    DROP COLUMN status, DROP COLUMN description, DROP COLUMN code;
