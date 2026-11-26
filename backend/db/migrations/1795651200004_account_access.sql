-- Up Migration
CREATE TYPE public.account_role AS ENUM ('member', 'superadmin');
CREATE TYPE public.account_state AS ENUM ('active', 'revoked');
CREATE TYPE public.invitation_status AS ENUM ('pending', 'failed', 'revoked', 'activated');

CREATE TABLE public.account_access (
    user_id text PRIMARY KEY REFERENCES public."user" (id),
    role public.account_role NOT NULL,
    state public.account_state NOT NULL DEFAULT 'active',
    division_id uuid REFERENCES public.divisions (id),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((role = 'member') = (division_id IS NOT NULL))
);

INSERT INTO public.account_access (user_id, role, division_id)
SELECT id, 'member', division_id FROM public.members;

CREATE INDEX account_access_active_division_idx ON public.account_access (division_id, user_id)
    WHERE role = 'member' AND state = 'active';

-- Keep each prior membership addressable by historical task assignments.
ALTER TABLE public.tasks DROP CONSTRAINT tasks_division_id_pic_id_fkey;
ALTER TABLE public.members
    DROP CONSTRAINT members_pkey,
    DROP CONSTRAINT members_division_id_id_key,
    ADD PRIMARY KEY (division_id, id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_division_id_pic_id_fkey
    FOREIGN KEY (division_id, pic_id) REFERENCES public.members (division_id, id);

CREATE TABLE public.invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
    role public.account_role NOT NULL,
    division_id uuid REFERENCES public.divisions (id),
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz NOT NULL,
    status public.invitation_status NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((role = 'member') = (division_id IS NOT NULL))
);

CREATE UNIQUE INDEX invitations_open_email_idx ON public.invitations (email)
    WHERE status IN ('pending', 'failed');

ALTER TABLE public.audit_log ALTER COLUMN division_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION app_private.member_division_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT access.division_id
    FROM public.account_access AS access
    WHERE access.user_id = nullif(current_setting('app.user_id', true), '')
        AND access.role = 'member' AND access.state = 'active'
$$;

CREATE FUNCTION app_private.is_superadmin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT EXISTS (
        SELECT FROM public.account_access AS access
        WHERE access.user_id = nullif(current_setting('app.user_id', true), '')
            AND access.role = 'superadmin' AND access.state = 'active'
    )
$$;

CREATE FUNCTION app_private.is_active_member(member_division uuid, member_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT (
        coalesce(member_division = (SELECT app_private.active_division_id()), false)
        OR (SELECT app_private.is_superadmin())
    ) AND EXISTS (
        SELECT FROM public.account_access AS access
        WHERE access.user_id = member_id AND access.division_id = member_division
            AND access.role = 'member' AND access.state = 'active'
    )
$$;

REVOKE ALL ON FUNCTION app_private.is_superadmin() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.is_active_member(uuid, text) FROM PUBLIC;

ALTER TABLE public.account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_access_read ON public.account_access FOR SELECT
    USING (user_id = (SELECT nullif(current_setting('app.user_id', true), ''))
        OR (SELECT app_private.is_superadmin()));
CREATE POLICY account_access_admin_insert ON public.account_access FOR INSERT
    WITH CHECK ((SELECT app_private.is_superadmin()));
CREATE POLICY account_access_admin_update ON public.account_access FOR UPDATE
    USING ((SELECT app_private.is_superadmin()))
    WITH CHECK ((SELECT app_private.is_superadmin()));

CREATE POLICY invitations_admin_scope ON public.invitations
    USING ((SELECT app_private.is_superadmin()))
    WITH CHECK ((SELECT app_private.is_superadmin()));

CREATE POLICY divisions_admin_read ON public.divisions FOR SELECT
    USING ((SELECT app_private.is_superadmin()));
CREATE POLICY members_admin_read ON public.members FOR SELECT
    USING ((SELECT app_private.is_superadmin()));
CREATE POLICY members_admin_insert ON public.members FOR INSERT
    WITH CHECK ((SELECT app_private.is_superadmin()));
CREATE POLICY members_admin_update ON public.members FOR UPDATE
    USING ((SELECT app_private.is_superadmin()))
    WITH CHECK ((SELECT app_private.is_superadmin()));
CREATE POLICY projects_admin_read ON public.projects FOR SELECT
    USING ((SELECT app_private.is_superadmin()));
CREATE POLICY tasks_admin_read ON public.tasks FOR SELECT
    USING ((SELECT app_private.is_superadmin()));

-- Down Migration
DROP POLICY tasks_admin_read ON public.tasks;
DROP POLICY projects_admin_read ON public.projects;
DROP POLICY members_admin_update ON public.members;
DROP POLICY members_admin_insert ON public.members;
DROP POLICY members_admin_read ON public.members;
DROP POLICY divisions_admin_read ON public.divisions;
DROP TABLE public.invitations, public.account_access;

CREATE OR REPLACE FUNCTION app_private.member_division_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT member.division_id FROM public.members AS member
    WHERE member.id = nullif(current_setting('app.user_id', true), '')
$$;

DROP FUNCTION app_private.is_active_member(uuid, text);
DROP FUNCTION app_private.is_superadmin();

ALTER TABLE public.tasks DROP CONSTRAINT tasks_division_id_pic_id_fkey;
ALTER TABLE public.members DROP CONSTRAINT members_pkey,
    ADD PRIMARY KEY (id), ADD UNIQUE (division_id, id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_division_id_pic_id_fkey
    FOREIGN KEY (division_id, pic_id) REFERENCES public.members (division_id, id);
ALTER TABLE public.audit_log ALTER COLUMN division_id SET NOT NULL;

DROP TYPE public.invitation_status, public.account_state, public.account_role;
