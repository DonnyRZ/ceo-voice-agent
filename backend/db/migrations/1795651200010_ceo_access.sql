-- Up Migration
ALTER TYPE public.account_role ADD VALUE IF NOT EXISTS 'ceo';

-- The new enum value becomes usable when the migration batch commits.
CREATE FUNCTION app_private.is_ceo() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT EXISTS (
        SELECT FROM public.account_access AS access
        WHERE access.user_id = nullif(current_setting('app.user_id', true), '')
            AND access.role::text = 'ceo' AND access.state = 'active'
    )
$$;

REVOKE ALL ON FUNCTION app_private.is_ceo() FROM PUBLIC;

CREATE POLICY divisions_ceo_read ON public.divisions FOR SELECT
    USING ((SELECT app_private.is_ceo()));
CREATE POLICY members_ceo_read ON public.members FOR SELECT
    USING ((SELECT app_private.is_ceo()));
CREATE POLICY projects_ceo_read ON public.projects FOR SELECT
    USING ((SELECT app_private.is_ceo()));
CREATE POLICY tasks_ceo_read ON public.tasks FOR SELECT
    USING ((SELECT app_private.is_ceo()));

-- Down Migration
DROP POLICY tasks_ceo_read ON public.tasks;
DROP POLICY projects_ceo_read ON public.projects;
DROP POLICY members_ceo_read ON public.members;
DROP POLICY divisions_ceo_read ON public.divisions;
DROP FUNCTION app_private.is_ceo();
