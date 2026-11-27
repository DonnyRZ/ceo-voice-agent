import { Pool } from 'pg';

let pool;
try {
  const url = new URL(process.env.DATABASE_ADMIN_URL ?? '');
  const runtime = new URL(process.env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['postgres:', 'postgresql:'].includes(runtime.protocol)
    || url.hostname !== runtime.hostname || (url.port || '5432') !== (runtime.port || '5432')
    || url.pathname !== runtime.pathname || url.username === runtime.username) throw new Error('Konfigurasi database berbeda.');
  pool = new Pool({ connectionString: url.href, connectionTimeoutMillis: 5_000 });
  const { rows: [row] } = await pool.query(`SELECT current_setting('server_version_num')::int AS version,
    current_database() AS database, (SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_trgm'))::int AS extensions`);
  if (!/^ceo_voice_agent_(stage|prod)$/.test(row.database) || row.extensions !== 2) {
    throw new Error('Database lingkungan dan ekstensi vector/pg_trgm harus disiapkan terlebih dahulu.');
  }
  if (process.argv[2] === 'pg-env') {
    const values = {
      PGVERSION: String(Math.floor(row.version / 10_000)), PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: row.database,
      PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
    };
    if (Object.values(values).some((value) => /[\r\n\0]/.test(value))) throw new Error('Nilai koneksi database tidak valid.');
    for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`);
  } else throw new Error('Operasi database tidak didukung.');
} catch {
  console.error('Pemeriksaan database deployment gagal. Periksa koneksi, nama database, dan ekstensi.');
  process.exitCode = 1;
} finally { await pool?.end(); }
