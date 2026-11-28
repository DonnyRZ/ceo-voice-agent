import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('registration audit keeps private output encrypted and forces read-only PostgreSQL',()=>{
  const root=mkdtempSync(join(tmpdir(),'registration-audit-test-'));
  try {
    mkdirSync(join(root,'keys'));
    const keys=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-subj','/CN=local-audit-test','-keyout',join(root,'keys/private.key'),'-out',join(root,'keys/public.crt')],{encoding:'utf8'});
    assert.equal(keys.status,0);
    const script=`
import importlib.util,json,os,secrets,subprocess,sys
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('audit','infra/audit/registration.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=Path(sys.argv[1]);site=root/'stage';(site/'shared').mkdir(parents=True)
secret=secrets.token_hex(24)
(site/'shared/migrate.env').write_text('DATABASE_ADMIN_URL=postgresql://ceo_stage_owner:'+secret+'@127.0.0.1:5432/ceo_voice_agent_stage\\n')
payload=json.dumps({'database':'ceo_voice_agent_stage','read_only':'on','private':secrets.token_hex(24)})
real=subprocess.run
def run(args,**kwargs):
    if args[0]=='psql':
        assert 'default_transaction_read_only=on' in kwargs['env']['PGOPTIONS']
        assert 'PGPASSWORD' not in kwargs['env'] and secret not in ' '.join(args)
        assert Path(kwargs['env']['PGPASSFILE']).stat().st_mode&0o777==0o600
        assert kwargs['input'].startswith('BEGIN READ ONLY;') and kwargs['input'].rstrip().endswith('ROLLBACK;')
        return subprocess.CompletedProcess(args,0,stdout=payload,stderr='')
    return real(args,**kwargs)
certificate=(root/'keys/public.crt').read_bytes();out=root/'artifact/result.cms'
with patch.object(module.subprocess,'run',side_effect=run):module.audit(site,'fixture@example.test',certificate,out)
assert payload.encode() not in out.read_bytes() and secret.encode() not in out.read_bytes()
assert out.stat().st_mode&0o777==0o600
decrypted=real(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(out),'-recip',str(root/'keys/public.crt'),'-inkey',str(root/'keys/private.key')],capture_output=True,check=True)
assert decrypted.stdout.decode()==payload
for invalid in ['bad\\nsubject','bad@subject\\x00']:
    try:module.audit(site,invalid,certificate,out)
    except ValueError:pass
    else:raise AssertionError('invalid subject accepted')
(site/'shared/migrate.env').write_text('DATABASE_ADMIN_URL=postgresql://ceo_prod_owner:'+secret+'@127.0.0.1:5432/ceo_voice_agent_prod\\n')
try:module.audit(site,'fixture@example.test',certificate,out)
except ValueError:pass
else:raise AssertionError('production audit accepted')
print('PASS')
`;
    const result=spawnSync('python3',['-c',script,root],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),'PASS');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('registration audit is a manual owner-only staging operation outside the release jobs',()=>{
  const workflow=readFileSync('.github/workflows/checks.yml','utf8');
  const job=workflow.split('\n  registration-audit:')[1].split('\n  vps-readiness:')[0];
  assert.match(job,/workflow_dispatch/);
  assert.match(job,/github.actor == github.repository_owner/);
  assert.match(job,/github.ref_name == 'develop'/);
  assert.match(job,/environment: stage/);
  assert.match(job,/retention-days: 1/);
  assert.doesNotMatch(job,/publish\.sh|db:migrate|pull.*image/);
});
