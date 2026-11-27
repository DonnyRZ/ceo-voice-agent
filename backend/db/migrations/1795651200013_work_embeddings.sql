-- Up Migration
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE public.work_search_embeddings (
    kind text NOT NULL CHECK (kind IN ('project', 'task')),
    resource_id uuid NOT NULL,
    division_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    content_hash text NOT NULL,
    embedding public.vector(1536),
    model text,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT '-infinity',
    lease_id uuid,
    lease_model text,
    lease_expires_at timestamptz,
    PRIMARY KEY (kind, resource_id)
);

CREATE INDEX work_search_embeddings_cosine_idx ON public.work_search_embeddings
    USING hnsw (embedding public.vector_cosine_ops) WHERE embedding IS NOT NULL;
CREATE INDEX work_search_embeddings_scope_idx ON public.work_search_embeddings (kind, division_id, model);

ALTER TABLE public.work_search_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_search_embeddings_ceo_read ON public.work_search_embeddings FOR SELECT
    USING ((SELECT app_private.is_ceo()));

CREATE FUNCTION app_private.work_search_content_hash(title text, description text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(title, description)::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION app_private.sync_work_search_embedding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    entity_kind text := TG_ARGV[0];
    document_title text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.work_search_embeddings
        WHERE kind = entity_kind AND resource_id = OLD.id;
        RETURN NULL;
    END IF;

    document_title := to_jsonb(NEW) ->> TG_ARGV[1];
    INSERT INTO public.work_search_embeddings (kind, resource_id, division_id, title, description, content_hash)
    VALUES (entity_kind, NEW.id, NEW.division_id, document_title, NEW.description,
        app_private.work_search_content_hash(document_title, NEW.description))
    ON CONFLICT (kind, resource_id) DO UPDATE SET
        division_id = excluded.division_id, title = excluded.title, description = excluded.description,
        content_hash = excluded.content_hash, embedding = NULL, model = NULL, attempts = 0,
        next_attempt_at = '-infinity', lease_id = NULL, lease_model = NULL, lease_expires_at = NULL
    WHERE (work_search_embeddings.division_id, work_search_embeddings.title, work_search_embeddings.description)
        IS DISTINCT FROM (excluded.division_id, excluded.title, excluded.description);
    RETURN NULL;
END
$$;

CREATE TRIGGER sync_project_search_embedding
    AFTER INSERT OR UPDATE OF name, description, division_id OR DELETE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION app_private.sync_work_search_embedding('project', 'name');
CREATE TRIGGER sync_task_search_embedding
    AFTER INSERT OR UPDATE OF title, description, division_id OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION app_private.sync_work_search_embedding('task', 'title');

INSERT INTO public.work_search_embeddings (kind, resource_id, division_id, title, description, content_hash)
SELECT 'project', id, division_id, name, description, app_private.work_search_content_hash(name, description)
FROM public.projects
UNION ALL
SELECT 'task', id, division_id, title, description, app_private.work_search_content_hash(title, description)
FROM public.tasks
ON CONFLICT (kind, resource_id) DO NOTHING;

CREATE FUNCTION public.claim_work_search_embeddings(embedding_model text, batch_size integer)
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

CREATE FUNCTION public.complete_work_search_embedding(
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

CREATE FUNCTION public.retry_work_search_embedding(
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

REVOKE ALL ON FUNCTION app_private.work_search_content_hash(text, text),
    app_private.sync_work_search_embedding(), public.claim_work_search_embeddings(text, integer),
    public.complete_work_search_embedding(text, uuid, uuid, text, public.vector),
    public.retry_work_search_embedding(text, uuid, uuid, integer) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.retry_work_search_embedding(text, uuid, uuid, integer);
DROP FUNCTION public.complete_work_search_embedding(text, uuid, uuid, text, public.vector);
DROP FUNCTION public.claim_work_search_embeddings(text, integer);
DROP TRIGGER sync_task_search_embedding ON public.tasks;
DROP TRIGGER sync_project_search_embedding ON public.projects;
DROP FUNCTION app_private.sync_work_search_embedding();
DROP FUNCTION app_private.work_search_content_hash(text, text);
DROP TABLE public.work_search_embeddings;
