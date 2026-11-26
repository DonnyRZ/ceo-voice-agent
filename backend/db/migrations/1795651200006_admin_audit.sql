-- Up Migration
ALTER TABLE public.audit_log ADD COLUMN actor_name text, ADD COLUMN actor_email text;
UPDATE public.audit_log AS a
SET actor_name = u.name, actor_email = u.email
FROM public."user" AS u
WHERE u.id = a.actor_id;

CREATE INDEX audit_log_changed_idx ON public.audit_log (changed_at DESC, id DESC);
CREATE INDEX audit_log_division_changed_idx ON public.audit_log (division_id, changed_at DESC, id DESC);

CREATE FUNCTION app_private.snapshot_audit_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    SELECT u.name, u.email INTO NEW.actor_name, NEW.actor_email
    FROM public."user" AS u
    WHERE u.id = NEW.actor_id;
    RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app_private.snapshot_audit_actor() FROM PUBLIC;

CREATE TRIGGER snapshot_audit_actor BEFORE INSERT ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION app_private.snapshot_audit_actor();

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_superadmin_select ON public.audit_log FOR SELECT
    USING ((SELECT app_private.is_superadmin()));

CREATE OR REPLACE FUNCTION public.task_status_history(task_id uuid)
RETURNS TABLE (id text, changed_at timestamptz, previous_status text, status text, actor_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT event.id::text, event.changed_at,
        event.old_row ->> 'status', event.new_row ->> 'status', coalesce(event.actor_name, member.name)
    FROM public.audit_log AS event
    LEFT JOIN public.members AS member ON member.id = event.actor_id AND member.division_id = event.division_id
    WHERE event.record_table = 'tasks'
        AND event.record_id = task_id::text
        AND ((SELECT app_private.is_superadmin()) OR event.division_id = (SELECT app_private.active_division_id()))
        AND event.action = 'UPDATE'
        AND (event.old_row ->> 'status') IS DISTINCT FROM (event.new_row ->> 'status')
    ORDER BY event.id DESC
$$;

-- Down Migration
CREATE OR REPLACE FUNCTION public.task_status_history(task_id uuid)
RETURNS TABLE (id text, changed_at timestamptz, previous_status text, status text, actor_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT event.id::text, event.changed_at,
        event.old_row ->> 'status', event.new_row ->> 'status', member.name
    FROM public.audit_log AS event
    LEFT JOIN public.members AS member ON member.id = event.actor_id AND member.division_id = event.division_id
    WHERE event.record_table = 'tasks'
        AND event.record_id = task_id::text
        AND event.division_id = (SELECT app_private.active_division_id())
        AND event.action = 'UPDATE'
        AND (event.old_row ->> 'status') IS DISTINCT FROM (event.new_row ->> 'status')
    ORDER BY event.id DESC
$$;

DROP POLICY audit_superadmin_select ON public.audit_log;
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;
DROP TRIGGER snapshot_audit_actor ON public.audit_log;
DROP FUNCTION app_private.snapshot_audit_actor();
DROP INDEX public.audit_log_changed_idx, public.audit_log_division_changed_idx;
ALTER TABLE public.audit_log DROP COLUMN actor_email, DROP COLUMN actor_name;
