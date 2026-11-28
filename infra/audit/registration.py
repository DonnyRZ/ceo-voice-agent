"""Staging-only read-only diagnostic; private results leave the VPS only as CMS AES-GCM ciphertext."""
import base64
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit


def audit(site, subject, certificate, output):
    if not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+', subject) or len(subject)>254:
        raise ValueError('subject')
    if b'-----BEGIN CERTIFICATE-----' not in certificate or b'PRIVATE KEY' in certificate:
        raise ValueError('public certificate')
    read_value=runpy.run_path(str(Path(__file__).parent.parent/'deploy/readiness-db.py'))['value_from_file']
    connection=urlsplit(read_value(Path(site)/'shared/migrate.env','DATABASE_ADMIN_URL'))
    if connection.scheme not in ('postgres','postgresql') or unquote(connection.path)!='/ceo_voice_agent_stage' \
        or unquote(connection.username or '')!='ceo_stage_owner' or not connection.hostname or not connection.password:
        raise ValueError('stage connection')
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=connection.hostname,PGPORT=str(connection.port or 5432),PGDATABASE='ceo_voice_agent_stage',
        PGUSER='ceo_stage_owner',PGCONNECT_TIMEOUT='5',
        PGSSLMODE=parse_qs(connection.query).get('sslmode',['prefer'])[0],
        PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000')
    parts=[connection.hostname,str(connection.port or 5432),'ceo_voice_agent_stage','ceo_stage_owner',unquote(connection.password)]
    if any(any(c in part for c in '\r\n\0') for part in parts):raise ValueError('connection characters')
    with tempfile.TemporaryDirectory(prefix='ceo-registration-audit-') as directory:
        private=Path(directory);os.chmod(private,0o700)
        passfile=private/'pgpass';cert=private/'recipient.crt'
        passfile.write_text(':'.join(p.replace('\\','\\\\').replace(':','\\:') for p in parts)+'\n');passfile.chmod(0o600)
        cert.write_bytes(certificate);cert.chmod(0o600);env['PGPASSFILE']=str(passfile)
        result=subprocess.run(['psql','-XqAt','--no-password','-v','ON_ERROR_STOP=1','-v','subject='+subject],
            input=Path(__file__).with_suffix('.sql').read_text(),env=env,capture_output=True,text=True,timeout=20,check=True)
        data=json.loads(result.stdout)
        if data.get('read_only')!='on' or data.get('database')!='ceo_voice_agent_stage':raise ValueError('read-only guard')
        output=Path(output);output.parent.mkdir(parents=True,exist_ok=True);output.parent.chmod(0o700)
        subprocess.run(['openssl','cms','-encrypt','-aes-256-gcm','-binary','-outform','DER','-recip',str(cert),'-out',str(output)],
            input=result.stdout.encode(),capture_output=True,timeout=10,check=True)
        output.chmod(0o600)


if __name__=='__main__':
    try:
        audit(os.environ['AUDIT_SITE'],os.environ['AUDIT_SUBJECT'].strip().lower(),
            base64.b64decode(os.environ['AUDIT_CERT_BASE64'],validate=True),os.environ['AUDIT_OUTPUT'])
        print('Read-only staging audit completed; only encrypted evidence was saved.')
    except Exception:
        print('Read-only staging audit failed; private errors and credentials were not printed.',file=sys.stderr)
        sys.exit(1)
