import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { listVoiceTests, readVoiceTest } from '../modules/ai/voice/history/report.js';
import type { LiveHandlers, VoiceAdapter } from '../modules/ai/voice/types.js';
import { prepareAdminFixture } from './admin-fixture.js';

vi.mock('../modules/ai/budget.js', async (original) => ({
  ...await original<typeof import('../modules/ai/budget.js')>(),
  openBudget: () => ({ reserve: () => () => {} }),
}));

const sessions = '/api/ceo/voice/sessions';
const offer = 'v=0\r\ns=test-history-offer\r\nt=0 0\r\n';
const payload = { sdp: offer };

describe('Riwayat tes manual Voice Agent', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  let live: LiveHandlers;

  const adapter: VoiceAdapter = {
    createSession: vi.fn(async () => ({ id: 'synthetic-provider-id', sdp: 'test-history-answer' })),
    async attach(_id, handlers) {
      live = handlers;
      return {
        sendCommentary(eventId) {
          live.onEvent({ type: 'commentary_accepted', eventId });
        },
        finish: async () => true,
      };
    },
    closeSession: async () => live.onEvent({ type: 'closed', seconds: 12 }),
  };

  beforeAll(async () => {
    vi.stubEnv('AI_VOICE_ENABLED', 'true');
    vi.stubEnv('AI_VOICE_TEST_HISTORY_ENABLED', 'true');
    vi.stubEnv('AI_EMBEDDINGS_ENABLED', 'false');
    vi.stubEnv('OPENAI_API_KEY', 'unused-test-key');
    vi.stubEnv('OPENAI_VOICE_MODEL', 'synthetic-history-model');
    fixture = await prepareAdminFixture({ voiceAudit: { adapter } });
  }, 30_000);

  afterAll(async () => {
    await fixture?.close();
    vi.unstubAllEnvs();
  }, 15_000);

  it('menyimpan transkrip, fakta sumber, respons, latensi, dan penutupan sesi', async () => {
    const headers = await fixture.login('ceo@ruangkerja.test');
    const otherLogin = await fixture.login('ceo@ruangkerja.test');
    const created = await fixture.app.inject({ method: 'POST', url: sessions, headers, payload });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    const url = sessions + '/' + id;
    const sample = { method: 'POST' as const, url: url + '/telemetry', payload: { elapsedMs: 850 } };
    expect((await fixture.app.inject({ ...sample, headers: otherLogin })).statusCode).toBe(404);
    await fixture.app.inject({ ...sample, headers, payload: { elapsedMs: 100 } });

    const user = { eventId: 'user-1', role: 'user' as const, text: 'Apa status tugas Uji notifikasi?', startMs: 100, endMs: 800 };
    live.onEvent({ type: 'active' });
    live.onEvent({ type: 'transcript', fragment: user });
    live.onEvent({ type: 'transcript', fragment: user });
    live.onEvent({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
    await vi.waitFor(async () => {
      const report = await readVoiceTest(fixture.db, id);
      expect(report?.events.map(({ entry }) => entry)).toContainEqual({
        type: 'playback', turnId: 'turn-1', allowed: true,
      });
    }, 4_000);
    expect((await fixture.app.inject({ ...sample, headers })).statusCode).toBe(204);
    await fixture.app.inject({ ...sample, headers, payload: { elapsedMs: 900 } });

    live.onEvent({
      type: 'transcript', fragment: {
        eventId: 'agent-1', role: 'assistant', text: 'Tugas tersebut belum ', startMs: 1_800, endMs: 2_000,
      },
    });
    live.onEvent({
      type: 'transcript', fragment: {
        eventId: 'agent-2', role: 'assistant', text: 'selesai.', startMs: 2_000, endMs: 2_400,
      },
    });
    live.onEvent({
      type: 'transcript', fragment: {
        eventId: 'follow-up', role: 'user', text: 'Boleh minta update?', startMs: 3_000, endMs: 3_600,
      },
    });
    live.onEvent({ type: 'standby' });
    expect((await fixture.app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(204);

    await vi.waitFor(async () => {
      expect(await listVoiceTests(fixture.db, 10)).toContainEqual(expect.objectContaining({
        sessionId: id, model: 'synthetic-history-model', turnCount: 1, browserPlaybackSamples: 1, closedBecause: 'ended',
      }));
    }, 4_000);
    const report = await readVoiceTest(fixture.db, id);
    expect(report).toMatchObject({
      sessionId: id,
      hasSequenceGaps: false,
      transcript: [
        { role: 'user', text: user.text, startMs: 100, endMs: 800 },
        { role: 'assistant', text: 'Tugas tersebut belum selesai.', startMs: 1_800, endMs: 2_400 },
        { role: 'user', text: 'Boleh minta update?', startMs: 3_000, endMs: 3_600 },
      ],
    });
    expect(report?.events.map(({ entry }) => entry)).toEqual(expect.arrayContaining([
      { type: 'turn_input', turnId: 'turn-1', text: user.text, userEndMs: 800, delegationOffsetMs: 1_000 },
      expect.objectContaining({
        type: 'commentary_sent', turnId: 'turn-1', result: expect.objectContaining({
          kind: 'facts', facts: expect.objectContaining({ status: 'done', entity: expect.objectContaining({ name: 'Uji notifikasi' }) }),
        }),
      }),
      { type: 'metric', turnId: 'turn-1', metric: { type: 'latency', stage: 'input_to_delegation', outcome: 'observed', durationMs: 200 } },
      { type: 'metric', turnId: 'turn-1', metric: { type: 'retrieval', outcome: 'facts', durationMs: expect.any(Number) } },
      { type: 'metric', turnId: 'turn-1', metric: { type: 'latency', stage: 'commentary_ack', outcome: 'accepted', durationMs: expect.any(Number) } },
      { type: 'metric', turnId: 'turn-1', metric: { type: 'latency', stage: 'delegation_to_playback_allowed', outcome: 'observed', durationMs: expect.any(Number) } },
      { type: 'browser_playback', elapsedMs: 850 },
      { type: 'playback_stopped', turnId: 'turn-1', reason: 'new_speech' },
      { type: 'usage', final: true, seconds: 12 },
    ]));
    expect(JSON.stringify(report)).not.toMatch(/unused-test-key|sessionKey|synthetic-provider-id|test-history-offer/);
  });

  it('mencatat kegagalan membuat sesi dan membatasi pembacaan ke operator database', async () => {
    vi.mocked(adapter.createSession).mockRejectedValueOnce(new Error('synthetic private error'));
    const headers = await fixture.login('ceo@ruangkerja.test');
    const failed = await fixture.app.inject({ method: 'POST', url: sessions, headers, payload });
    expect(failed.statusCode).toBe(503);
    await vi.waitFor(async () => {
      expect(await listVoiceTests(fixture.db, 10)).toContainEqual(expect.objectContaining({
        turnCount: 0, browserPlaybackSamples: 0, closedBecause: 'unavailable',
      }));
    }, 4_000);

    const runtimeDb = new Client({ connectionString: fixture.config.DATABASE_URL });
    try {
      await runtimeDb.connect();
      await expect(listVoiceTests(runtimeDb, 10)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtimeDb.end();
    }
  });
});
