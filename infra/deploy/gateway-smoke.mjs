// Real HTTP/SSE switching test. No browser, OpenAI calls, VPS, or application database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, copyFile, chmod, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const ops = dirname(fileURLToPath(import.meta.url));
async function command(bin, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (s) => { output += s; }); child.stderr.on('data', (s) => { output += s; });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${bin} failed (${code}): ${output}`)));
  });
}
async function listen(server) { await new Promise((r) => server.listen(0, '127.0.0.1', r)); return server.address().port; }
async function freePort() { const server = createServer(); const port = await listen(server); await new Promise((r) => server.close(r)); return port; }
function backend(slot) {
  const hosts = new Set();
  const server = createServer((req, res) => {
    hosts.add(req.headers.host);
    if (req.url.endsWith('/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${slot}\n\n`);
      const timer = setInterval(() => res.write(`data: ${slot}\n\n`), 25);
      req.on('close', () => clearInterval(timer));
    } else { res.writeHead(200); res.end(slot); }
  });
  server.hosts = hosts;
  return server;
}

test('atomic route switching keeps HTTP/SSE connections and voice ownership intact', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ceo-gateway-smoke-'));
  const blue = backend('blue'), green = backend('green');
  const name = `ceo-gateway-smoke-${process.pid}`;
  const abort = new AbortController(); let reader;
  try {
    const bluePort = await listen(blue), greenPort = await listen(green);
    const port = await freePort();
    const configDir = join(directory, 'gateway');
    await mkdir(configDir, { mode: 0o755 });
    await chmod(configDir, 0o755);
    const env = { ...process.env, OPS: ops, stage: 'stage', site: directory,
      BLUE_PORT: String(bluePort), GREEN_PORT: String(greenPort), GATEWAY_PORT: String(port), GATEWAY_CONFIG_DIR: configDir };
    async function route(target) {
      await command('bash', ['-c', 'source "$OPS/gateway.sh"; set_gateway_route "$TARGET"'], { ...env, TARGET: target });
      // No secrets exist in this fixture; allow the root container to stat owner-created files.
      await chmod(join(configDir, target + '.live'), 0o644);
    }
    await mkdir(join(configDir, 'routes/blue'), { recursive: true });
    await mkdir(join(configDir, 'routes/green'), { recursive: true });
    for (const item of ['routes', 'routes/blue', 'routes/green']) await chmod(join(configDir, item), 0o755);
    for (const slot of ['blue', 'green']) {
      await writeFile(join(configDir, 'routes', slot, slot), '');
      await chmod(join(configDir, 'routes', slot, slot), 0o644);
    }
    await command('bash', ['-c', 'source "$OPS/gateway.sh"; write_gateway "$OUTPUT"'],
      { ...env, OUTPUT: join(configDir, 'active.Caddyfile') });
    await chmod(join(configDir, 'active.Caddyfile'), 0o644);
    await chmod(directory, 0o755);
    await mkdir(join(configDir, 'static/assets'), { recursive: true, mode: 0o755 });
    await writeFile(join(configDir, 'static/assets/previous-hash.js'), 'old-bundle');
    for (const item of ['static', 'static/assets']) await chmod(join(configDir, item), 0o755);
    await chmod(join(configDir, 'static/assets/previous-hash.js'), 0o644);
    const image = 'caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
    await route('blue');
    await command('docker', ['run', '-d', '--name', name, '--network', 'host', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'NET_BIND_SERVICE',
      '--security-opt', 'no-new-privileges', '-v', `${configDir}:/etc/ceo:ro`, image,
      'caddy', 'run', '--config', '/etc/ceo/active.Caddyfile', '--adapter', 'caddyfile']);
    const url = `http://127.0.0.1:${port}`;
    // Native HTTP preserves the Host header; Node fetch can silently replace it.
    const request = (path = '', init = {}) => new Promise((resolve, reject) => {
      const req = httpRequest(new URL(url + path), { method: init.method || 'GET', signal: init.signal,
        headers: { Host: 'ceo-stage.example.test', 'X-Forwarded-Proto': 'https', ...init.headers } }, (res) => {
        const headers = new Headers();
        for (const [name, values] of Object.entries(res.headers)) {
          for (const value of Array.isArray(values) ? values : [values]) if (value !== undefined) headers.append(name, value);
        }
        resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers }));
      });
      req.on('error', reject); req.end();
    });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { if ((await request('', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert.equal(ready, true, ready ? 'gateway startup' : await command('docker', ['logs', name]));
    const session = await request('/api/ceo/voice/sessions', { method: 'POST' });
    assert.match(session.headers.get('set-cookie'), /ceo_voice_slot=blue;.*HttpOnly; Secure; SameSite=Strict/);
    assert.equal(await session.text(), 'blue');
    assert.equal(blue.hosts.has('ceo-stage.example.test'), true, 'the public Host must actually reach the backend');
    assert.equal(await (await request('/api/health', { headers: { Host: `127.0.0.1:${port}` } })).text(), 'blue');
    const cookie = { Cookie: 'other=1; ceo_voice_slot=blue' };
    const stream = await request('/api/ceo/voice/sessions/example/events', { headers: cookie, signal: abort.signal });
    reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /data: blue/);
    const failures = [];
    const traffic = (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const response = await request('/api/health', { signal: AbortSignal.timeout(2000) });
          const body = await response.text();
          if (!response.ok || !['blue', 'green'].includes(body)) failures.push(`${response.status} ${body}`);
        } catch (error) { failures.push(`${error.message}: ${error.cause?.code}`); }
        await delay(5);
      }
    })();
    // Exercise repeated blue/green switching while requests and the old stream are live.
    for (let index = 0; index < 20; index++) {
      await route(index % 2 === 0 ? 'blue' : 'green');
      await delay(10);
    }
    await traffic;
    assert.deepEqual(failures, [], 'no failed requests during atomic switching');
    assert.equal(await (await request('/api/health')).text(), 'green');
    assert.equal(await (await request('/assets/previous-hash.js')).text(), 'old-bundle');
    assert.equal(await (await request('/api/ceo/voice/sessions/example/turns/t/audio', { headers: cookie })).text(), 'blue');
    const fresh = await request('/api/ceo/voice/sessions', { method: 'POST', headers: cookie });
    assert.match(fresh.headers.get('set-cookie'), /ceo_voice_slot=green/);
    assert.equal(await fresh.text(), 'green');
    assert.match(new TextDecoder().decode((await reader.read()).value), /data: blue/, 'old stream survives route switches');
    assert.equal((await request('/internal/deployment/drain', { method: 'POST' })).status, 404);
    await assert.rejects(route('purple'));
    assert.equal(await (await request()).text(), 'green', 'invalid target cannot change routing');
    // Reverse the pointer without restarting/reloading the gateway or either process.
    await route('blue');
    assert.equal(await (await request()).text(), 'blue');
  } finally {
    abort.abort(); await reader?.cancel().catch(() => {});
    await command('docker', ['rm', '-f', name]).catch(() => {});
    for (const server of [blue, green]) { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
    await rm(directory, { recursive: true, force: true });
  }
});
