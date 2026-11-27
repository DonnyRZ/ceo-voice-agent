-- Up Migration
CREATE INDEX audit_log_work_title_idx ON public.audit_log (
    record_table, lower(coalesce(new_row ->> 'title', new_row ->> 'name'))
) WHERE record_table IN ('tasks', 'projects') AND new_row IS NOT NULL;

CREATE INDEX audit_log_work_text_idx ON public.audit_log USING gin (
    to_tsvector('simple'::regconfig, coalesce(new_row ->> 'title', new_row ->> 'name') || ' '
        || coalesce(new_row ->> 'description', ''))
) WHERE record_table IN ('tasks', 'projects') AND new_row IS NOT NULL;

CREATE INDEX audit_log_work_title_trgm_idx ON public.audit_log USING gin (
    lower(coalesce(new_row ->> 'title', new_row ->> 'name')) public.gin_trgm_ops
) WHERE record_table IN ('tasks', 'projects') AND new_row IS NOT NULL;

CREATE INDEX audit_log_work_description_trgm_idx ON public.audit_log USING gin (
    lower(coalesce(new_row ->> 'description', '')) public.gin_trgm_ops
) WHERE record_table IN ('tasks', 'projects') AND new_row IS NOT NULL;

CREATE FUNCTION public.ceo_search_work(
    target_kind text, needle text, scope_division uuid, cutoff timestamptz, exact_match boolean
) RETURNS TABLE (id text, name text, division_id uuid, score double precision)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    work_table text := CASE target_kind WHEN 'task' THEN 'tasks' WHEN 'project' THEN 'projects' END;
    work_title text := CASE target_kind WHEN 'task' THEN 'title' WHEN 'project' THEN 'name' END;
    source_sql text;
BEGIN
    IF NOT app_private.is_ceo() OR work_table IS NULL OR needle IS NULL OR btrim(needle) = '' THEN
        RETURN;
    END IF;

    -- The chosen identifiers are fixed above. Text, scope, and time remain bound parameters.
    IF cutoff IS NULL THEN
        source_sql := format($source$
            SELECT work.id::text AS resource_id, work.%I AS title, work.description, work.division_id
            FROM public.%I AS work
            WHERE ($2::uuid IS NULL OR work.division_id = $2)
        $source$, work_title, work_table);
    ELSE
        source_sql := format($source$
            SELECT audit.record_id AS resource_id, coalesce(audit.new_row ->> 'title', audit.new_row ->> 'name') AS title,
                coalesce(audit.new_row ->> 'description', '') AS description, audit.division_id
            FROM public.audit_log AS audit
            WHERE audit.record_table IN ('tasks', 'projects') AND audit.record_table = %L
                AND audit.new_row IS NOT NULL AND audit.changed_at <= $3::timestamptz
                AND ($2::uuid IS NULL OR audit.division_id = $2)
                AND NOT EXISTS (
                    SELECT FROM public.audit_log AS newer
                    WHERE newer.record_table IN ('tasks', 'projects') AND newer.record_table = audit.record_table
                        AND newer.record_id = audit.record_id AND newer.changed_at <= $3
                        AND (newer.changed_at, newer.id) > (audit.changed_at, audit.id)
                )
        $source$, work_table);
    END IF;

    IF exact_match THEN
        RETURN QUERY EXECUTE format($search$
            WITH source AS NOT MATERIALIZED (%s)
            SELECT work.resource_id, work.title, work.division_id, 1.0::double precision
            FROM source AS work WHERE lower(work.title) = $1
            ORDER BY work.title, work.resource_id LIMIT 8
        $search$, source_sql) USING needle, scope_division, cutoff;
        RETURN;
    END IF;

    RETURN QUERY EXECUTE format($search$
        WITH source AS NOT MATERIALIZED (%s), shortlist AS (
            (SELECT * FROM source AS work
                WHERE to_tsvector('simple', work.title || ' ' || work.description) @@ plainto_tsquery('simple', $1)
                LIMIT 32)
            UNION
            (SELECT * FROM source AS work WHERE lower(work.title) OPERATOR(public.%%) $1 LIMIT 32)
            UNION
            (SELECT * FROM source AS work WHERE lower(work.description) OPERATOR(public.%%) $1 LIMIT 32)
        )
        SELECT work.resource_id, work.title, work.division_id,
            CASE WHEN lower(work.title) = $1 THEN 1.0
                WHEN to_tsvector('simple', work.title) @@ plainto_tsquery('simple', $1) THEN 0.82
                WHEN to_tsvector('simple', work.title || ' ' || work.description) @@ plainto_tsquery('simple', $1) THEN 0.63
                ELSE greatest(public.similarity(lower(work.title), $1), public.similarity(lower(work.description), $1) * 0.8)
            END::double precision AS rank
        FROM shortlist AS work
        ORDER BY rank DESC, work.title, work.resource_id LIMIT 8
    $search$, source_sql) USING needle, scope_division, cutoff;
END
$$;

REVOKE ALL ON FUNCTION public.ceo_search_work(text, text, uuid, timestamptz, boolean) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.ceo_search_work(text, text, uuid, timestamptz, boolean);
DROP INDEX public.audit_log_work_description_trgm_idx, public.audit_log_work_title_trgm_idx,
    public.audit_log_work_text_idx, public.audit_log_work_title_idx;
