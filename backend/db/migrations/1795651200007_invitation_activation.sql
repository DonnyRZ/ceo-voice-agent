-- Up Migration
CREATE FUNCTION app_private.guard_access_division() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    division_open boolean;
BEGIN
    IF NEW.division_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'account_access' THEN
        IF NEW.state <> 'active' THEN
            RETURN NEW;
        END IF;
    ELSE
        IF NEW.status <> 'pending' THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT division.status = 'active' INTO division_open
    FROM public.divisions AS division WHERE division.id = NEW.division_id FOR SHARE;
    IF division_open IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Divisi tujuan harus aktif.';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER guard_active_account_division BEFORE INSERT OR UPDATE ON public.account_access
    FOR EACH ROW EXECUTE FUNCTION app_private.guard_access_division();
CREATE TRIGGER guard_pending_invitation_division BEFORE INSERT OR UPDATE ON public.invitations
    FOR EACH ROW EXECUTE FUNCTION app_private.guard_access_division();

CREATE FUNCTION app_private.audit_access_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    before_change jsonb := (CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END) - 'token_hash';
    after_change jsonb := (CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END) - 'token_hash';
    changed_record jsonb := coalesce(after_change, before_change);
    subject_id text := coalesce(changed_record ->> 'user_id', changed_record ->> 'id');
    subject_email text;
BEGIN
    IF TG_TABLE_NAME = 'account_access' THEN
        SELECT identity.email INTO subject_email FROM public."user" AS identity WHERE identity.id = subject_id;
        before_change := before_change || jsonb_build_object('email', subject_email);
        after_change := after_change || jsonb_build_object('email', subject_email);
    END IF;
    INSERT INTO public.audit_log (record_table, record_id, division_id, action, actor_id, old_row, new_row)
    VALUES (
        TG_TABLE_NAME, subject_id, (changed_record ->> 'division_id')::uuid, TG_OP,
        nullif(current_setting('app.user_id', true), ''), before_change, after_change
    );
    RETURN NULL;
END
$$;

CREATE TRIGGER audit_account_access_change AFTER INSERT OR UPDATE OR DELETE ON public.account_access
    FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_change();
CREATE TRIGGER audit_invitations_change AFTER INSERT OR UPDATE OR DELETE ON public.invitations
    FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_change();

CREATE FUNCTION public.invitation_is_open(requested_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT EXISTS (
        SELECT FROM public.invitations AS invitation
        LEFT JOIN public.divisions AS division ON division.id = invitation.division_id
        WHERE invitation.token_hash = requested_hash AND invitation.status = 'pending'
            AND invitation.expires_at > statement_timestamp()
            AND (invitation.division_id IS NULL OR division.status = 'active')
    )
$$;

CREATE FUNCTION public.complete_invitation(
    requested_hash text, new_user_id text, new_account_id text, full_name text, credential_hash text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET app.user_id = '' AS $$
DECLARE
    target_division uuid;
    division_open boolean;
    claimed public.invitations%ROWTYPE;
    inserted_user_id text;
BEGIN
    SELECT invitation.division_id INTO target_division
    FROM public.invitations AS invitation WHERE invitation.token_hash = requested_hash;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF target_division IS NOT NULL THEN
        SELECT division.status = 'active' INTO division_open
        FROM public.divisions AS division WHERE division.id = target_division FOR SHARE;
        IF division_open IS DISTINCT FROM true THEN
            RETURN NULL;
        END IF;
    END IF;

    SELECT * INTO claimed
    FROM public.invitations AS invitation WHERE invitation.token_hash = requested_hash FOR UPDATE;
    IF NOT FOUND OR claimed.status <> 'pending' OR claimed.expires_at <= clock_timestamp()
        OR claimed.division_id IS DISTINCT FROM target_division THEN
        RETURN NULL;
    END IF;

    INSERT INTO public."user" (id, name, email, "emailVerified")
    VALUES (new_user_id, full_name, claimed.email, true)
    ON CONFLICT (email) DO NOTHING RETURNING id INTO inserted_user_id;
    IF inserted_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('app.user_id', inserted_user_id, true);
    INSERT INTO public.account (id, "accountId", "providerId", "userId", password)
    VALUES (new_account_id, inserted_user_id, 'credential', inserted_user_id, credential_hash);
    INSERT INTO public.account_access (user_id, role, division_id)
    VALUES (inserted_user_id, claimed.role, claimed.division_id);
    IF claimed.role = 'member' THEN
        INSERT INTO public.members (id, division_id, name)
        VALUES (inserted_user_id, claimed.division_id, full_name);
    END IF;

    UPDATE public.invitations SET status = 'activated', version = version + 1, updated_at = clock_timestamp()
    WHERE id = claimed.id;
    RETURN claimed.email;
END
$$;

CREATE FUNCTION public.fail_invitation_delivery(invitation_id uuid, dispatch_hash text)
RETURNS TABLE (version integer, updated_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    UPDATE public.invitations AS invitation
    SET status = 'failed', version = invitation.version + 1, updated_at = clock_timestamp()
    WHERE invitation.id = invitation_id AND invitation.token_hash = dispatch_hash AND invitation.status = 'pending'
    RETURNING invitation.version, invitation.updated_at
$$;

REVOKE ALL ON FUNCTION app_private.guard_access_division(), app_private.audit_access_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invitation_is_open(text), public.complete_invitation(text, text, text, text, text),
    public.fail_invitation_delivery(uuid, text) FROM PUBLIC;

-- Down Migration
DROP FUNCTION public.fail_invitation_delivery(uuid, text);
DROP FUNCTION public.complete_invitation(text, text, text, text, text);
DROP FUNCTION public.invitation_is_open(text);
DROP TRIGGER audit_invitations_change ON public.invitations;
DROP TRIGGER audit_account_access_change ON public.account_access;
DROP FUNCTION app_private.audit_access_change();
DROP TRIGGER guard_pending_invitation_division ON public.invitations;
DROP TRIGGER guard_active_account_division ON public.account_access;
DROP FUNCTION app_private.guard_access_division();
