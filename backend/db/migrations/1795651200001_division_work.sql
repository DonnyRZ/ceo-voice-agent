-- Up Migration
CREATE TYPE public.work_status AS ENUM ('pending', 'on_progress', 'done');

CREATE TABLE public.divisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE CHECK (btrim(name) <> '')
);

CREATE TABLE public.members (
    id text PRIMARY KEY REFERENCES public."user" (id),
    division_id uuid NOT NULL REFERENCES public.divisions (id),
    name text NOT NULL CHECK (btrim(name) <> ''),
    UNIQUE (division_id, id)
);

CREATE TABLE public.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id uuid NOT NULL REFERENCES public.divisions (id),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    status public.work_status NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (division_id, id)
);

CREATE TABLE public.tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id uuid NOT NULL REFERENCES public.divisions (id),
    date date NOT NULL,
    title text NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL DEFAULT '',
    project_id uuid NOT NULL,
    pic_id text NOT NULL,
    status public.work_status NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (division_id, project_id) REFERENCES public.projects (division_id, id),
    FOREIGN KEY (division_id, pic_id) REFERENCES public.members (division_id, id)
);

CREATE INDEX projects_division_name_idx ON public.projects (division_id, name);
CREATE INDEX tasks_division_date_idx ON public.tasks (division_id, date DESC, id);
CREATE INDEX tasks_division_project_idx ON public.tasks (division_id, project_id, date DESC);
CREATE INDEX tasks_division_pic_idx ON public.tasks (division_id, pic_id, date DESC);
CREATE INDEX tasks_division_status_idx ON public.tasks (division_id, status, date DESC);

-- Down Migration
DROP TABLE public.tasks, public.projects, public.members, public.divisions;
DROP TYPE public.work_status;
