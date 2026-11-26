-- Up Migration
CREATE TABLE public.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_table text NOT NULL,
    record_id text NOT NULL,
    division_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    actor_id text,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    old_row jsonb,
    new_row jsonb
);

CREATE INDEX audit_log_record_idx
    ON public.audit_log (record_table, record_id, division_id, id DESC);

CREATE FUNCTION app_private.audit_work_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    before_change jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    after_change jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    record jsonb := coalesce(after_change, before_change);
BEGIN
    INSERT INTO public.audit_log (record_table, record_id, division_id, action, actor_id, old_row, new_row)
    VALUES (
        TG_TABLE_NAME,
        record ->> 'id',
        coalesce(record ->> 'division_id', record ->> 'id')::uuid,
        TG_OP,
        nullif(current_setting('app.user_id', true), ''),
        before_change,
        after_change
    );
    RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app_private.audit_work_change() FROM PUBLIC;

CREATE TRIGGER audit_divisions_change AFTER INSERT OR UPDATE OR DELETE ON public.divisions
    FOR EACH ROW EXECUTE FUNCTION app_private.audit_work_change();
CREATE TRIGGER audit_members_change AFTER INSERT OR UPDATE OR DELETE ON public.members
    FOR EACH ROW EXECUTE FUNCTION app_private.audit_work_change();
CREATE TRIGGER audit_projects_change AFTER INSERT OR UPDATE OR DELETE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION app_private.audit_work_change();
CREATE TRIGGER audit_tasks_change AFTER INSERT OR UPDATE OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION app_private.audit_work_change();

CREATE FUNCTION public.task_status_history(task_id uuid)
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

REVOKE ALL ON FUNCTION public.task_status_history(uuid) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.task_status_history(uuid);
DROP TRIGGER audit_tasks_change ON public.tasks;
DROP TRIGGER audit_projects_change ON public.projects;
DROP TRIGGER audit_members_change ON public.members;
DROP TRIGGER audit_divisions_change ON public.divisions;
DROP FUNCTION app_private.audit_work_change();
DROP TABLE public.audit_log;
