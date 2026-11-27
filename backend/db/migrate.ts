import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

const { DATABASE_ADMIN_URL: adminUrl, DATABASE_URL: runtimeUrl } = process.env;

if (!adminUrl || !runtimeUrl) {
    throw new Error('DATABASE_ADMIN_URL dan DATABASE_URL wajib dikonfigurasi.');
}

const roleName = decodeURIComponent(new URL(runtimeUrl).username);
const client = new pg.Client({ connectionString: adminUrl });

try {
    await client.connect();
    const { rows: [role] } = await client.query<{ identifier: string; eligible: boolean }>(`
        SELECT quote_ident(rolname) AS identifier,
            rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolreplication
                OR pg_has_role(rolname, current_user, 'MEMBER')) AS eligible
        FROM pg_catalog.pg_roles
        WHERE rolname = $1
    `, [roleName]);

    if (!role?.eligible) {
        throw new Error('Role DATABASE_URL harus merupakan role login terpisah dengan RLS aktif.');
    }

    const migrations = await runner({
        dbClient: client,
        dir: fileURLToPath(new URL('./migrations', import.meta.url)),
        direction: 'up',
        migrationsTable: 'schema_migrations',
        singleTransaction: true,
    });

    // The role identifier comes from PostgreSQL quote_ident, never raw configuration.
    const runtime = role.identifier;
    await client.query(`
        GRANT USAGE ON SCHEMA public, app_private TO ${runtime};
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            public."user", public.session, public.account, public.verification TO ${runtime};
        GRANT SELECT ON public.divisions, public.members TO ${runtime};
        GRANT INSERT, UPDATE ON public.divisions, public.members TO ${runtime};
        GRANT SELECT, INSERT, UPDATE ON public.account_access TO ${runtime};
        GRANT SELECT (id, email, role, division_id, expires_at, status, version, updated_at),
            INSERT, UPDATE ON public.invitations TO ${runtime};
        GRANT SELECT ON public.audit_log TO ${runtime};
        GRANT SELECT, INSERT, UPDATE ON public.projects, public.tasks TO ${runtime};
        GRANT SELECT (kind, resource_id, division_id, embedding, model)
            ON public.work_search_embeddings TO ${runtime};
        GRANT INSERT ON app_private.ceo_voice_test_events TO ${runtime};
        GRANT EXECUTE ON FUNCTION
            app_private.member_division_id(), app_private.active_division_id(),
            app_private.is_superadmin(), app_private.is_ceo(), app_private.is_active_member(uuid, text),
            app_private.work_title_key(text),
            public.task_status_history(uuid), public.invitation_is_open(text),
            public.complete_invitation(text, text, text, text, text),
            public.fail_invitation_delivery(uuid, text),
            public.ceo_work_status_as_of(text, uuid, timestamptz),
            public.ceo_work_status_history(text, uuid, timestamptz, timestamptz, integer),
            public.ceo_search_work(text, text, uuid, timestamptz, boolean),
            public.ceo_exact_work_labels(text[], text, uuid, timestamptz),
            public.claim_work_search_embeddings(text, integer),
            public.complete_work_search_embedding(text, uuid, uuid, text, public.vector),
            public.retry_work_search_embedding(text, uuid, uuid, integer) TO ${runtime};
    `);

    console.info(`${migrations.length} migrasi diterapkan. Akses runtime siap.`);
} finally {
    await client.end();
}
