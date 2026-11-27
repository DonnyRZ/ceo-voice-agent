import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetExceeded, openBudget } from '../modules/ai/budget.js';
import type { CeoFacts } from '../modules/ai/retrieval/schema.js';
import { createVoiceService } from '../modules/ai/voice/service.js';
import { prepareAdminFixture } from './admin-fixture.js';

const offer = 'v=0\r\ns=offer-test\r\nt=0 0\r\n';
const answer = 'v=0\r\ns=answer-test\r\nt=0 0\r\n';
const base = '/api/ceo/voice/sessions';

describe('API layar uji suara CEO', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  const service = createVoiceService<unknown, CeoFacts>({
    adapter: {
      createSession: async () => ({ id: 'live_test', sdp: answer }),
      attach: async () => ({ sendCommentary() {}, finish: async () => true }),
      closeSession: async () => {},
    },
    retrieve: async () => ({ kind: 'unsupported', text: 'Pertanyaan uji.' }),
  });

  beforeAll(async () => {
    fixture = await prepareAdminFixture({ voice: service });
  }, 30_000);
  afterAll(async () => fixture?.close(), 15_000);

  it('menolak pengunjung dan anggota divisi', async () => {
    const guest = await fixture.app.inject({ method: 'POST', url: base, payload: { sdp: offer } });
    expect(guest.statusCode).toBe(401);
    const headers = await fixture.login('doni@ruangkerja.test');
    const member = await fixture.app.inject({ method: 'POST', url: base, headers, payload: { sdp: offer } });
    expect(member.statusCode).toBe(403);
  });

  it('mengikat sesi suara ke sesi login dan menolak SDP yang salah', async () => {
    const headers = await fixture.login('ceo@ruangkerja.test');
    const otherLogin = await fixture.login('ceo@ruangkerja.test');
    const invalid = await fixture.app.inject({ method: 'POST', url: base, headers, payload: { sdp: 'invalid' } });
    expect(invalid.statusCode).toBe(400);
    const created = await fixture.app.inject({ method: 'POST', url: base, headers, payload: { sdp: offer } });
    expect(created.statusCode).toBe(201);
    const { id, sdp } = created.json();
    expect(sdp).toBe(answer);
    expect(id).not.toBe('live_test');
    const url = base + '/' + id;
    const unauthorized = await fixture.app.inject({ method: 'DELETE', url, headers: otherLogin });
    expect(unauthorized.statusCode).toBe(404);
    const events = await fixture.app.inject({ method: 'GET', url: url + '/events', headers: otherLogin });
    expect(events.statusCode).toBe(404);
    const ended = await fixture.app.inject({ method: 'DELETE', url, headers });
    expect(ended.statusCode).toBe(204);
  });
});

it('menahan anggaran yang belum dikonfirmasi dan menyimpannya antarproses', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-budget-'));
  try {
    const ledger = join(directory, 'budget.json');
    const settle = openBudget(5, ledger).reserve(100_000, true);
    expect(() => openBudget(5, ledger).reserve(1)).toThrow(BudgetExceeded);
    settle(100_000);
    settle(200_000);
    expect(() => openBudget(5, ledger).reserve(4_900_001)).toThrow(BudgetExceeded);
    openBudget(5, ledger).reserve(4_900_000)(4_900_000);
    expect(() => openBudget(5, ledger).reserve(1)).toThrow(BudgetExceeded);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
