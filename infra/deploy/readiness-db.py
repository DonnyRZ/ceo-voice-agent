"""Read-only PostgreSQL readiness; never print URLs, passwords, or raw errors."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit


def value_from_file(path, key):
    values = []
    for line in Path(path).read_text().splitlines():
        name, separator, value = line.partition('=')
        if separator and name.strip() == key:
            values.append(value.strip().strip('\"\''))
    if len(values) != 1 or not values[0]:
        raise ValueError('configuration')
    return values[0]


def query(url, stage, kind):
    connection = urlsplit(url)
    database = f'ceo_voice_agent_{stage}'
    other = 'ceo_voice_agent_prod' if stage == 'stage' else 'ceo_voice_agent_stage'
    role = f'ceo_{stage}_{kind}'
    if connection.scheme not in ('postgres', 'postgresql') or unquote(connection.path) != f'/{database}' \
            or unquote(connection.username or '') != role or not connection.hostname or not connection.password:
        raise ValueError('connection')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    # All connection values are read from the private server file at runtime.
    env.update({
        'PGHOST': connection.hostname, 'PGPORT': str(connection.port or 5432), 'PGDATABASE': database,
        'PGUSER': role,
        'PGCONNECT_TIMEOUT': '5', 'PGSSLMODE': parse_qs(connection.query).get('sslmode', ['prefer'])[0],
        'PGOPTIONS': '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000',
    })
    sql = f"""SELECT json_build_object(
      'database', current_database(), 'role', current_user,
      'version', current_setting('server_version'),
      'extensions', (SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_trgm')),
      'safe_role', (SELECT rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
                   FROM pg_roles WHERE rolname=current_user),
      'owns_database', (SELECT pg_get_userbyid(datdba)=current_user FROM pg_database WHERE datname=current_database()),
      'cross_connect', has_database_privilege(current_user, '{other}', 'CONNECT'),
      'member_of_owner', pg_has_role(current_user, 'ceo_{stage}_owner', 'MEMBER'))"""
    # libpq reads a private short-lived passfile, keeping credentials out of argv/env.
    parts = [connection.hostname, str(connection.port or 5432), database, role, unquote(connection.password)]
    if any(any(character in part for character in '\r\n\0') for part in parts):
        raise ValueError('connection characters')
    with tempfile.TemporaryDirectory(prefix='ceo-readiness-') as directory:
        passfile = Path(directory) / 'pgpass'
        with os.fdopen(os.open(passfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as handle:
            handle.write(':'.join(part.replace('\\', '\\\\').replace(':', '\\:') for part in parts) + '\n')
        env['PGPASSFILE'] = str(passfile)
        result = subprocess.run(['psql', '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                                env=env, capture_output=True, text=True, timeout=12, check=True)
    row = json.loads(result.stdout)
    if row['database'] != database or row['role'] != role or row['extensions'] != 2 \
            or int(row['version'].split('.')[0]) < 15 or not row['safe_role'] or row['cross_connect'] \
            or row['owns_database'] != (kind == 'owner') or (kind == 'app' and row['member_of_owner']):
        raise ValueError('database policy')
    return row


def main():
    site, stage = Path(sys.argv[1]), sys.argv[2]
    if stage not in ('stage', 'prod'):
        raise ValueError('environment')
    runtime = value_from_file(site / 'shared/api.env', 'DATABASE_URL')
    owner = value_from_file(site / 'shared/migrate.env', 'DATABASE_ADMIN_URL')
    a, b = urlsplit(runtime), urlsplit(owner)
    if (a.hostname, a.port or 5432, a.path) != (b.hostname, b.port or 5432, b.path):
        raise ValueError('database target')
    for kind, url in [('app', runtime), ('owner', owner)]:
        print(json.dumps(query(url, stage, kind), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Readiness database gagal; periksa konfigurasi/koneksi/hak akses privat di server.', file=sys.stderr)
        sys.exit(1)
