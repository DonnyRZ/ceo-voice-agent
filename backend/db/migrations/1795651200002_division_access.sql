-- Up Migration
CREATE SCHEMA app_private;

-- Run as the table owner to resolve membership without a recursive RLS policy.
CREATE FUNCTION app_private.member_division_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT member.division_id
    FROM public.members AS member
    WHERE member.id = nullif(current_setting('app.user_id', true), '')
$$;

CREATE FUNCTION app_private.active_division_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT member_division
    FROM (SELECT app_private.member_division_id() AS member_division) AS scope
    WHERE member_division::text = nullif(current_setting('app.division_id', true), '')
$$;

REVOKE ALL ON FUNCTION app_private.member_division_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.active_division_id() FROM PUBLIC;

ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY divisions_member_scope ON public.divisions FOR SELECT
    USING (id = (SELECT app_private.member_division_id()));

CREATE POLICY members_division_scope ON public.members FOR SELECT
    USING (division_id = (SELECT app_private.member_division_id()));

CREATE POLICY projects_division_scope ON public.projects
    USING (division_id = (SELECT app_private.active_division_id()))
    WITH CHECK (division_id = (SELECT app_private.active_division_id()));

CREATE POLICY tasks_division_scope ON public.tasks
    USING (division_id = (SELECT app_private.active_division_id()))
    WITH CHECK (division_id = (SELECT app_private.active_division_id()));

-- Down Migration
DROP POLICY tasks_division_scope ON public.tasks;
DROP POLICY projects_division_scope ON public.projects;
DROP POLICY members_division_scope ON public.members;
DROP POLICY divisions_member_scope ON public.divisions;

ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions DISABLE ROW LEVEL SECURITY;

DROP FUNCTION app_private.active_division_id();
DROP FUNCTION app_private.member_division_id();
DROP SCHEMA app_private;
