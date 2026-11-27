-- Up Migration
CREATE INDEX audit_log_work_snapshot_idx
    ON public.audit_log (record_table, record_id, changed_at DESC, id DESC)
    WHERE record_table IN ('tasks', 'projects');

CREATE FUNCTION public.ceo_work_status_as_of(kind text, resource_id uuid, cutoff timestamptz)
RETURNS TABLE (
    status public.work_status, changed_at timestamptz, evidence_id text, division_id uuid,
    title text, task_date date, project_id uuid, pic_id text, pic_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT (event.new_row ->> 'status')::public.work_status, event.changed_at, event.id::text,
        event.division_id, coalesce(event.new_row ->> 'title', event.new_row ->> 'name'),
        (event.new_row ->> 'date')::date, (event.new_row ->> 'project_id')::uuid,
        event.new_row ->> 'pic_id', pic.name
    FROM (
        SELECT audit.id, audit.changed_at, audit.division_id, audit.new_row, audit.action
        FROM public.audit_log AS audit
        WHERE (SELECT app_private.is_ceo())
            AND audit.record_table IN ('tasks', 'projects')
            AND audit.record_table = CASE $1 WHEN 'task' THEN 'tasks' WHEN 'project' THEN 'projects' END
            AND audit.record_id = $2::text AND audit.changed_at <= $3
        ORDER BY audit.changed_at DESC, audit.id DESC
        LIMIT 1
    ) AS event
    LEFT JOIN LATERAL (
        SELECT member.new_row ->> 'name' AS name
        FROM public.audit_log AS member
        WHERE member.record_table = 'members' AND member.division_id = event.division_id
            AND member.record_id = (event.new_row ->> 'pic_id') AND member.changed_at <= $3
        ORDER BY member.changed_at DESC, member.id DESC
        LIMIT 1
    ) AS pic ON true
    WHERE event.action <> 'DELETE'
$$;

CREATE FUNCTION public.ceo_work_status_history(
    kind text, resource_id uuid, from_time timestamptz, to_time timestamptz, row_limit integer
) RETURNS TABLE (
    id text, changed_at timestamptz, previous_status public.work_status,
    status public.work_status, actor_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT audit.id::text, audit.changed_at, (audit.old_row ->> 'status')::public.work_status,
        (audit.new_row ->> 'status')::public.work_status, audit.actor_name
    FROM public.audit_log AS audit
    WHERE (SELECT app_private.is_ceo())
        AND audit.record_table IN ('tasks', 'projects')
        AND audit.record_table = CASE $1 WHEN 'task' THEN 'tasks' WHEN 'project' THEN 'projects' END
        AND audit.record_id = $2::text AND audit.action = 'UPDATE'
        AND ($3 IS NULL OR audit.changed_at >= $3) AND ($4 IS NULL OR audit.changed_at < $4)
        AND (audit.old_row ->> 'status') IS DISTINCT FROM (audit.new_row ->> 'status')
    ORDER BY audit.changed_at DESC, audit.id DESC
    LIMIT least(greatest(coalesce($5, 10), 1), 50)
$$;

REVOKE ALL ON FUNCTION public.ceo_work_status_as_of(text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ceo_work_status_history(text, uuid, timestamptz, timestamptz, integer) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.ceo_work_status_history(text, uuid, timestamptz, timestamptz, integer);
DROP FUNCTION public.ceo_work_status_as_of(text, uuid, timestamptz);
DROP INDEX public.audit_log_work_snapshot_idx;
