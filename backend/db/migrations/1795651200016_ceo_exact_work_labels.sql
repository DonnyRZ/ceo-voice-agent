-- Up Migration
CREATE FUNCTION app_private.work_title_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
    SELECT btrim(regexp_replace(lower(translate(normalize(value, NFKC), '–—', '  ')
        COLLATE pg_catalog."und-x-icu"), '[[:space:]]+', ' ', 'g')) COLLATE "C"
$$;

CREATE INDEX projects_title_key_idx ON public.projects
    ((app_private.work_title_key(name) COLLATE "C"), division_id, id);
CREATE INDEX tasks_title_key_idx ON public.tasks
    ((app_private.work_title_key(title) COLLATE "C"), division_id, id);
CREATE INDEX audit_work_title_key_idx ON public.audit_log (
    (app_private.work_title_key(coalesce(new_row ->> 'title', new_row ->> 'name')) COLLATE "C"),
    record_table, division_id, changed_at DESC
) WHERE record_table IN ('tasks', 'projects') AND new_row IS NOT NULL;

CREATE FUNCTION public.ceo_exact_work_labels(
    needles text[], target_kind text, scope_division uuid, cutoff timestamptz
) RETURNS TABLE (
    probe text, key text, kind text, id uuid, name text, division_id uuid, division_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NOT app_private.is_ceo() OR coalesce(cardinality(needles), 0) NOT BETWEEN 1 AND 2048
        OR (target_kind IS NOT NULL AND target_kind NOT IN ('task', 'project')) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH requested AS MATERIALIZED (
        SELECT DISTINCT raw, app_private.work_title_key(raw) COLLATE "C" AS title_key
        FROM unnest(needles) AS input(raw)
        WHERE char_length(raw) BETWEEN 1 AND 512
    ), keys AS MATERIALIZED (
        SELECT DISTINCT title_key FROM requested WHERE title_key <> ''
    ), matched AS MATERIALIZED (
        SELECT keys.title_key, hit.* FROM keys
        CROSS JOIN LATERAL (
            (SELECT 'project'::text AS work_kind, work.id AS resource_id, work.name AS label, work.division_id AS scope
             FROM public.projects AS work
             WHERE cutoff IS NULL AND (target_kind IS NULL OR target_kind = 'project')
                AND (scope_division IS NULL OR work.division_id = scope_division)
                AND (app_private.work_title_key(work.name) COLLATE "C") = keys.title_key
             LIMIT 2)
            UNION ALL
            (SELECT 'task'::text, work.id, work.title, work.division_id
             FROM public.tasks AS work
             WHERE cutoff IS NULL AND (target_kind IS NULL OR target_kind = 'task')
                AND (scope_division IS NULL OR work.division_id = scope_division)
                AND (app_private.work_title_key(work.title) COLLATE "C") = keys.title_key
             LIMIT 2)
            UNION ALL
            (SELECT CASE event.record_table WHEN 'tasks' THEN 'task' ELSE 'project' END,
                event.record_id::uuid, coalesce(event.new_row ->> 'title', event.new_row ->> 'name'), event.division_id
             FROM public.audit_log AS event
             WHERE cutoff IS NOT NULL AND event.record_table IN ('tasks', 'projects') AND event.new_row IS NOT NULL
                AND (target_kind IS NULL OR event.record_table = CASE target_kind WHEN 'task' THEN 'tasks' ELSE 'projects' END)
                AND (scope_division IS NULL OR event.division_id = scope_division)
                AND event.changed_at <= cutoff
                AND (app_private.work_title_key(coalesce(event.new_row ->> 'title', event.new_row ->> 'name')) COLLATE "C") = keys.title_key
                AND NOT EXISTS (
                    SELECT FROM public.audit_log AS newer
                    WHERE newer.record_table IN ('tasks', 'projects') AND newer.record_table = event.record_table
                        AND newer.record_id = event.record_id AND newer.changed_at <= cutoff
                        AND (newer.changed_at, newer.id) > (event.changed_at, event.id)
                )
             LIMIT 2)
        ) AS hit
    )
    SELECT requested.raw, requested.title_key, matched.work_kind, matched.resource_id, matched.label, matched.scope, division.name
    FROM requested
    JOIN matched ON matched.title_key = requested.title_key
    JOIN public.divisions AS division ON division.id = matched.scope;
END
$$;

REVOKE ALL ON FUNCTION app_private.work_title_key(text),
    public.ceo_exact_work_labels(text[], text, uuid, timestamptz) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.ceo_exact_work_labels(text[], text, uuid, timestamptz);
DROP INDEX public.audit_work_title_key_idx, public.tasks_title_key_idx, public.projects_title_key_idx;
DROP FUNCTION app_private.work_title_key(text);
