import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const mode of ['good', 'empty-health', 'bad-health', 'empty-html', 'missing-root', 'missing-assets', 'foreign-asset', 'empty-js', 'wrong-mime']) {
  test(`public app verification ${mode} checks bodies and assets, not merely status`, () => {
    const result = spawnSync('python3', ['-c', `
import importlib.util,io,json,os
from email.message import Message
from urllib.parse import urlsplit
spec=importlib.util.spec_from_file_location('smoke','infra/deploy/public-smoke.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
mode=os.environ['MODE'];calls=[]
class Response(io.BytesIO):
 def __init__(self,body,mime):
  super().__init__(body);self.status=200;self.headers=Message();self.headers['Content-Type']=mime
html='<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">'
if mode=='empty-html':html=''
if mode=='missing-root':html=html.replace('id="root"','id="other"')
if mode=='missing-assets':html='<!doctype html><div id="root"></div>'
if mode=='foreign-asset':html=html.replace('/assets/app.js','https://other.example.test/assets/app.js')
def fetch(request,timeout):
 url=request if isinstance(request,str) else request.full_url;path=urlsplit(url).path;calls.append(path)
 if path=='/api/health':return Response(b'' if mode=='empty-health' else json.dumps({'status':'bad' if mode=='bad-health' else 'ok'}).encode(),'application/json')
 if path=='/':return Response(html.encode(),'text/html')
 assert request.headers['Range']=='bytes=0-1023'
 if path.endswith('.js'):return Response(b'' if mode=='empty-js' else b'console.log(1)', 'text/html' if mode=='wrong-mime' else 'text/javascript')
 return Response(b'body{}','text/css')
try:
 module.check_site('https://stage.example.test',fetch)
 assert mode=='good';assert len(calls)==4
except ValueError:
 assert mode!='good'
`], { encoding: 'utf8', env: { ...process.env, MODE: mode } });
    assert.equal(result.status, 0, result.stderr);
  });
}
