import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sessionsPath = '/api/ceo/voice/sessions';

// Optional local authenticated relay. It gates media to candidates from the current provider answer.
export async function openPilotRelay() {
  const helper = process.env.PILOT_TURN_HELPER;
  const assets = process.env.PILOT_TURN_ASSETS;
  if (!helper && !assets) return;
  if (!helper || !assets) throw new Error('Siapkan helper TURN lokal dan direktori asetnya.');
  const { startRelay } = await import(pathToFileURL(resolve(helper)));
  const scratch = await mkdtemp(join(tmpdir(), 'rk-voice-relay-'));
  try {
    const relay = await startRelay(scratch, resolve(assets));
    return {
      ice: { iceServers: [relay.credential], iceTransportPolicy: 'relay' },
      invalidate: relay.invalidate,
      install(app) {
        app.addHook('preHandler', async (request, reply) => {
          if (request.method !== 'POST' || request.url !== sessionsPath) return;
          let verified = false;
          try { verified = relay.offerIsRelay(request.body?.sdp); } catch {}
          if (!verified) return reply.code(403).send({ message: 'Kandidat relay pilot tidak valid.' });
        });
        app.addHook('onSend', async (request, reply, payload) => {
          if (request.method !== 'POST' || request.url !== sessionsPath || reply.statusCode !== 201) return payload;
          let id;
          try {
            const answer = JSON.parse(payload);
            id = answer.id;
            await relay.authorizeAnswer(answer.sdp);
            return payload;
          } catch {
            relay.invalidate();
            if (id) {
              await app.inject({ method: 'DELETE', url: sessionsPath + '/' + encodeURIComponent(id),
                headers: { cookie: request.headers.cookie, origin: request.headers.origin } });
            }
            reply.code(503);
            return JSON.stringify({ message: 'Izin relay untuk SDP GPT Live gagal diverifikasi.' });
          }
        });
      },
      async close() {
        await relay.close();
        await rm(scratch, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
