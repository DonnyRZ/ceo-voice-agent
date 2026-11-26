-- Up Migration
CREATE FUNCTION app_private.audit_profile_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    INSERT INTO public.audit_log
        (record_table, record_id, division_id, action, actor_id, old_row, new_row)
    SELECT 'account_access', NEW.id, access.division_id, 'UPDATE',
        nullif(current_setting('app.user_id', true), ''),
        jsonb_build_object('name', OLD.name, 'email', OLD.email),
        jsonb_build_object('name', NEW.name, 'email', NEW.email)
    FROM public.account_access AS access
    WHERE access.user_id = NEW.id;
    RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app_private.audit_profile_name() FROM PUBLIC;

CREATE TRIGGER audit_profile_name AFTER UPDATE OF name ON public."user"
    FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
    EXECUTE FUNCTION app_private.audit_profile_name();

-- Down Migration
DROP TRIGGER audit_profile_name ON public."user";
DROP FUNCTION app_private.audit_profile_name();
