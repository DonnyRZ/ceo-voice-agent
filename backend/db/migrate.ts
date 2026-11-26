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
        GRANT SELECT, INSERT, UPDATE ON public.projects, public.tasks TO ${runtime};
        GRANT EXECUTE ON FUNCTION
            app_private.member_division_id(), app_private.active_division_id(),
            public.task_status_history(uuid) TO ${runtime};
    `);

    console.info(`${migrations.length} migrasi diterapkan. Akses runtime siap.`);
} finally {
    await client.end();
}
