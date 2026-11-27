-- Up Migration
-- Expose active membership as a boolean, without widening account_access reads.
CREATE OR REPLACE FUNCTION app_private.is_active_member(member_division uuid, member_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT (
        coalesce(member_division = (SELECT app_private.active_division_id()), false)
        OR (SELECT app_private.is_superadmin()) OR (SELECT app_private.is_ceo())
    ) AND EXISTS (
        SELECT FROM public.account_access AS access
        WHERE access.user_id = member_id AND access.division_id = member_division
            AND access.role = 'member' AND access.state = 'active'
    )
$$;

CREATE INDEX tasks_recent_update_idx ON public.tasks (updated_at DESC, id);
CREATE INDEX tasks_reporting_date_idx ON public.tasks (date, division_id);

-- Down Migration
DROP INDEX public.tasks_reporting_date_idx;
DROP INDEX public.tasks_recent_update_idx;

CREATE OR REPLACE FUNCTION app_private.is_active_member(member_division uuid, member_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT (
        coalesce(member_division = (SELECT app_private.active_division_id()), false)
        OR (SELECT app_private.is_superadmin())
    ) AND EXISTS (
        SELECT FROM public.account_access AS access
        WHERE access.user_id = member_id AND access.division_id = member_division
            AND access.role = 'member' AND access.state = 'active'
    )
$$;
