-- Up Migration
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX projects_search_vector_idx ON public.projects USING gin (
    to_tsvector('simple'::regconfig, name || ' ' || description)
);
CREATE INDEX projects_search_name_idx ON public.projects (lower(name));
CREATE INDEX projects_search_name_trgm_idx ON public.projects USING gin (lower(name) public.gin_trgm_ops);
CREATE INDEX projects_search_description_trgm_idx ON public.projects USING gin (lower(description) public.gin_trgm_ops);

CREATE INDEX tasks_search_vector_idx ON public.tasks USING gin (
    to_tsvector('simple'::regconfig, title || ' ' || description)
);
CREATE INDEX tasks_search_title_idx ON public.tasks (lower(title));
CREATE INDEX tasks_search_title_trgm_idx ON public.tasks USING gin (lower(title) public.gin_trgm_ops);
CREATE INDEX tasks_search_description_trgm_idx ON public.tasks USING gin (lower(description) public.gin_trgm_ops);

CREATE INDEX tasks_work_date_idx ON public.tasks (date DESC, id);

-- Down Migration
DROP INDEX public.tasks_work_date_idx;
DROP INDEX public.tasks_search_description_trgm_idx, public.tasks_search_title_trgm_idx,
    public.tasks_search_title_idx, public.tasks_search_vector_idx;
DROP INDEX public.projects_search_description_trgm_idx, public.projects_search_name_trgm_idx,
    public.projects_search_name_idx, public.projects_search_vector_idx;
