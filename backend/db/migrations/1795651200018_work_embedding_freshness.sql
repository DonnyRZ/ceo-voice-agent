-- Up Migration
ALTER POLICY work_search_embeddings_ceo_read ON public.work_search_embeddings USING (
    (SELECT app_private.is_ceo()) AND EXISTS (
        SELECT FROM public.divisions AS division
        WHERE division.id = work_search_embeddings.division_id AND division.status = 'active'
    ) AND (
        (kind = 'project' AND EXISTS (
            SELECT FROM public.projects AS work
            WHERE work.id = work_search_embeddings.resource_id AND work.division_id = work_search_embeddings.division_id
                AND work.name = work_search_embeddings.title AND work.description = work_search_embeddings.description
        )) OR (kind = 'task' AND EXISTS (
            SELECT FROM public.tasks AS work
            WHERE work.id = work_search_embeddings.resource_id AND work.division_id = work_search_embeddings.division_id
                AND work.title = work_search_embeddings.title AND work.description = work_search_embeddings.description
        ))
    )
);

CREATE OR REPLACE FUNCTION public.claim_work_search_embeddings(embedding_model text, batch_size integer)
RETURNS TABLE (
    kind text, resource_id uuid, title text, description text, content_hash text, lease_id uuid, attempts integer
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH pending AS (
        SELECT work.kind, work.resource_id
        FROM public.work_search_embeddings AS work
        JOIN public.divisions AS division ON division.id = work.division_id AND division.status = 'active'
        WHERE nullif(current_setting('app.user_id', true), '') IS NULL
            AND btrim($1) <> '' AND (work.embedding IS NULL OR work.model IS DISTINCT FROM $1)
            AND work.next_attempt_at <= statement_timestamp()
            AND (work.lease_expires_at IS NULL OR work.lease_expires_at <= statement_timestamp())
        ORDER BY work.next_attempt_at, work.kind, work.resource_id
        LIMIT least(greatest(coalesce($2, 1), 1), 50)
        FOR UPDATE OF work SKIP LOCKED
    )
    UPDATE public.work_search_embeddings AS work
    SET lease_id = gen_random_uuid(), lease_model = $1,
        lease_expires_at = statement_timestamp() + interval '5 minutes',
        attempts = work.attempts + 1
    FROM pending WHERE work.kind = pending.kind AND work.resource_id = pending.resource_id
    RETURNING work.kind, work.resource_id, work.title, work.description, work.content_hash, work.lease_id, work.attempts
$$;

CREATE OR REPLACE FUNCTION public.complete_work_search_embedding(
    kind text, resource_id uuid, lease_id uuid, embedding_model text, embedding public.vector
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH completed AS (
        UPDATE public.work_search_embeddings AS work
        SET model = $4, embedding = $5, attempts = 0, next_attempt_at = '-infinity',
            lease_id = NULL, lease_model = NULL, lease_expires_at = NULL
        FROM public.divisions AS division
        WHERE nullif(current_setting('app.user_id', true), '') IS NULL AND $5 IS NOT NULL
            AND work.kind = $1 AND work.resource_id = $2 AND work.lease_id = $3 AND work.lease_model = $4
            AND work.lease_expires_at > clock_timestamp()
            AND division.id = work.division_id AND division.status = 'active'
        RETURNING 1
    )
    SELECT EXISTS (SELECT FROM completed)
$$;

CREATE OR REPLACE FUNCTION public.retry_work_search_embedding(
    kind text, resource_id uuid, lease_id uuid, delay_seconds integer
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH retried AS (
        UPDATE public.work_search_embeddings AS work
        SET next_attempt_at = statement_timestamp() + least(greatest(coalesce($4, 1), 1), 86400) * interval '1 second',
            lease_id = NULL, lease_model = NULL, lease_expires_at = NULL
        WHERE nullif(current_setting('app.user_id', true), '') IS NULL
            AND work.kind = $1 AND work.resource_id = $2 AND work.lease_id = $3
            AND work.lease_expires_at > clock_timestamp()
        RETURNING 1
    )
    SELECT EXISTS (SELECT FROM retried)
$$;

-- Down Migration
ALTER POLICY work_search_embeddings_ceo_read ON public.work_search_embeddings
    USING ((SELECT app_private.is_ceo()));

CREATE OR REPLACE FUNCTION public.claim_work_search_embeddings(embedding_model text, batch_size integer)
RETURNS TABLE (
    kind text, resource_id uuid, title text, description text, content_hash text, lease_id uuid, attempts integer
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH pending AS (
        SELECT work.kind, work.resource_id
        FROM public.work_search_embeddings AS work
        WHERE nullif(current_setting('app.user_id', true), '') IS NULL
            AND btrim($1) <> '' AND (work.embedding IS NULL OR work.model IS DISTINCT FROM $1)
            AND work.next_attempt_at <= statement_timestamp()
            AND (work.lease_expires_at IS NULL OR work.lease_expires_at <= statement_timestamp())
        ORDER BY work.next_attempt_at, work.kind, work.resource_id
        LIMIT least(greatest(coalesce($2, 1), 1), 50)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.work_search_embeddings AS work
    SET lease_id = gen_random_uuid(), lease_model = $1,
        lease_expires_at = statement_timestamp() + interval '5 minutes',
        attempts = work.attempts + 1
    FROM pending WHERE work.kind = pending.kind AND work.resource_id = pending.resource_id
    RETURNING work.kind, work.resource_id, work.title, work.description, work.content_hash, work.lease_id, work.attempts
$$;

CREATE OR REPLACE FUNCTION public.complete_work_search_embedding(
    kind text, resource_id uuid, lease_id uuid, embedding_model text, embedding public.vector
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH completed AS (
        UPDATE public.work_search_embeddings AS work
        SET model = $4, embedding = $5, attempts = 0, next_attempt_at = '-infinity',
            lease_id = NULL, lease_model = NULL, lease_expires_at = NULL
        WHERE nullif(current_setting('app.user_id', true), '') IS NULL AND $5 IS NOT NULL
            AND work.kind = $1 AND work.resource_id = $2 AND work.lease_id = $3 AND work.lease_model = $4
        RETURNING 1
    )
    SELECT EXISTS (SELECT FROM completed)
$$;

CREATE OR REPLACE FUNCTION public.retry_work_search_embedding(
    kind text, resource_id uuid, lease_id uuid, delay_seconds integer
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH retried AS (
        UPDATE public.work_search_embeddings AS work
        SET next_attempt_at = statement_timestamp() + least(greatest(coalesce($4, 1), 1), 86400) * interval '1 second',
            lease_id = NULL, lease_model = NULL, lease_expires_at = NULL
        WHERE nullif(current_setting('app.user_id', true), '') IS NULL
            AND work.kind = $1 AND work.resource_id = $2 AND work.lease_id = $3
        RETURNING 1
    )
    SELECT EXISTS (SELECT FROM retried)
$$;
