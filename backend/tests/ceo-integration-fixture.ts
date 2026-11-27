import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect } from 'vitest';
import { devAdminEmail, devCeoEmail } from '../db/admin-account.js';
import { inTransaction } from '../db/transaction.js';
import { loadCeoIdentity } from '../modules/auth/ceo-access.js';
import type { CeoInterpretation } from '../modules/ai/retrieval/interpretation.js';
import { retrieveCeoAnswer, type CeoRetrievalContext, type RetrievalDatabase } from '../modules/ai/retrieval/index.js';
import { prepareAdminFixture } from './admin-fixture.js';

type BaseFixture = Awaited<ReturnType<typeof prepareAdminFixture>>;
export type IntegrationSession = Awaited<ReturnType<BaseFixture['login']>>;
export type IntegrationProject = { id: string; name: string; description: string; status: string; version: number };
export type IntegrationTask = {
  id: string; title: string; description: string; date: string; projectId: string; projectName: string;
  divisionId: string; divisionName: string; picId: string; picName: string; status: string; version: number; updatedAt: string;
};

// This adapter tests production retrieval and RLS. It does not claim to evaluate model interpretation.
export function interpretation(patch: Partial<CeoInterpretation>): CeoInterpretation {
  return { kind: 'lookup', operation: 'status', target: 'named_work', subject: null, workKind: null,
    divisionId: null, from: null, to: null, asOf: null, statuses: [], selectionId: null, clarify: null,
    clear: [], correction: null, divisionExcerpt: null, summaryDetail: null, ...patch };
}

export async function prepareCeoIntegration() {
  const fixture = await prepareAdminFixture({ voice: {
    async start() { throw new Error('Pengujian integrasi tidak boleh membuka API suara berbayar.'); },
    async stop() {},
    subscribe() { throw new Error('Pengujian ini tidak membuka koneksi suara.'); },
    async closeAll() {},
  } });
  const runtime = new Pool({ connectionString: fixture.config.DATABASE_URL, connectionTimeoutMillis: 5_000 });
  try {
    const member = await fixture.login('doni@ruangkerja.test');
    const finance = await fixture.login('laura@ruangkerja.test');
    const admin = await fixture.login(devAdminEmail);
    const ceo = await fixture.login(devCeoEmail);
    const { rows: [owner] } = await fixture.db.query<{ userId: string; sessionId: string }>(`
      SELECT profile.id AS "userId", session.id AS "sessionId"
      FROM "user" profile JOIN session ON session."userId" = profile.id
      WHERE profile.email = $1 ORDER BY session."createdAt" DESC LIMIT 1`, [devCeoEmail]);

    const read = <T>(run: (db: RetrievalDatabase) => Promise<T>, snapshot = false) => inTransaction(runtime, async (db) => {
      if (snapshot) await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await db.query("SET LOCAL statement_timeout = '500ms'");
      if (!await loadCeoIdentity(db, owner.userId, owner.sessionId)) throw new Error('Sesi CEO sudah dicabut.');
      return run(db);
    }, { readOnly: true });
    const retrievalDb: RetrievalDatabase = {
      query: (sql, parameters) => read((connection) => connection.query(sql, parameters)),
      withSnapshot: (run) => read(run, true),
    };

    async function request<T>(url: string, headers: IntegrationSession, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
      payload?: object, expected = 200) {
      const response = await fixture.app.inject({ method, url, headers, payload });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(expected);
      return response.json<T>();
    }

    async function createWork() {
      const suffix = randomUUID().slice(0, 8);
      const project = await request<IntegrationProject>('/api/projects', member, 'POST', {
        name: `Proyek Lintas ${suffix}`, description: 'Deskripsi proyek untuk integrasi lintas peran.', status: 'pending',
      }, 201);
      const destination = await request<IntegrationProject>('/api/projects', member, 'POST', {
        name: `Proyek Tujuan ${suffix}`, description: 'Tujuan perpindahan tugas.', status: 'pending',
      }, 201);
      const members = await request<{ id: string; name: string }[]>('/api/members', member);
      const doni = members.find(({ name }) => name === 'Doni')!;
      const hakim = members.find(({ name }) => name === 'Hakim')!;
      expect(doni).toBeTruthy();
      expect(hakim).toBeTruthy();
      const draft = { title: `Pemeriksaan Integrasi ${suffix}`, description: 'Catatan awal belum selesai.',
        date: '2026-10-31', projectId: project.id, picId: doni.id, status: 'pending' };
      const task = await request<IntegrationTask>('/api/tasks', member, 'POST', draft, 201);
      return { project, destination, draft, task, doni, hakim };
    }

    function retrieve(transcript: string, value: CeoInterpretation, context?: CeoRetrievalContext) {
      return retrieveCeoAnswer({ db: retrievalDb, transcript, interpret: async () => value, context });
    }

    return { ...fixture, member, finance, admin, ceo, owner, retrievalDb, request, createWork, retrieve,
      async close() { await runtime.end(); await fixture.close(); } };
  } catch (error) {
    await runtime.end();
    await fixture.close();
    throw error;
  }
}

export type CeoIntegration = Awaited<ReturnType<typeof prepareCeoIntegration>>;
