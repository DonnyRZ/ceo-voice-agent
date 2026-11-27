import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { interpretation, prepareCeoIntegration, type CeoIntegration, type IntegrationTask } from './ceo-integration-fixture.js';

type Report = { counts: { tasks: number }; byStatus: Record<string, number>; recentTasks: IntegrationTask[] };
type TaskList = { tasks: IntegrationTask[] };
type QueueRow = { title: string; description: string; hash: string; embedding: string | null; model: string | null };

describe('integrasi sumber fakta Anggota Divisi, Superadmin, dan CEO', () => {
  let fixture: CeoIntegration;
  beforeAll(async () => { fixture = await prepareCeoIntegration(); }, 45_000);
  afterAll(async () => { await fixture?.close(); });

  test('perubahan tugas dan proyek terbaca sama di seluruh API serta retrieval produksi', async () => {
    const { request, member, admin, ceo, db } = fixture;
    const { project, destination, draft, task, hakim } = await fixture.createWork();
    const lookup = interpretation({ subject: task.title, workKind: 'task' });
    const initial = await fixture.retrieve(`Bagaimana status tugas ${task.title}?`, lookup);
    expect(initial).toMatchObject({ kind: 'facts', facts: { status: 'pending', picName: 'Doni', entity: { id: task.id } } });
    const readQueue = async () => (await db.query<QueueRow>(`
      SELECT title, description, content_hash AS hash, embedding::text, model
      FROM work_search_embeddings WHERE kind = 'task' AND resource_id = $1`, [task.id])).rows[0];
    const before = await readQueue();
    const vector = JSON.stringify([1, ...Array<number>(1535).fill(0)]);
    await db.query(`UPDATE work_search_embeddings SET embedding = $2::vector, model = 'integration-vector'
      WHERE kind = 'task' AND resource_id = $1`, [task.id, vector]);

    await request(`/api/projects/${destination.id}`, member, 'PATCH', { name: `${destination.name} Final`,
      description: 'Deskripsi proyek diperbarui oleh anggota.', status: 'on_progress', version: destination.version });
    const patch = { ...draft, title: `${task.title} Final`, description: 'Uji akses selesai. Bukti pemeriksaan tercatat.',
      date: '2026-11-27', status: 'done', picId: hakim.id, projectId: destination.id, version: task.version };
    const latest = await request<IntegrationTask>(`/api/tasks/${task.id}`, member, 'PATCH', patch);
    const expected = { id: task.id, title: patch.title, description: patch.description, date: patch.date,
      status: 'done', picId: hakim.id, picName: 'Hakim', projectId: destination.id, projectName: `${destination.name} Final` };

    for (const [path, headers] of [[`/api/admin/tasks/${task.id}`, admin], [`/api/ceo/tasks/${task.id}`, ceo]] as const) {
      expect(await request(path, headers)).toMatchObject({ ...expected, updatedAt: latest.updatedAt });
    }
    const projectDetail = await request<TaskList>(`/api/ceo/projects/${destination.id}`, ceo);
    expect(projectDetail.tasks).toEqual([expect.objectContaining(expected)]);
    const oldProject = await request<TaskList>(`/api/ceo/projects/${project.id}`, ceo);
    expect(oldProject.tasks).toEqual([]);
    const { user } = await request<{ user: { divisionId: string } }>('/api/session', member);
    const division = await request<TaskList>(`/api/ceo/divisions/${user.divisionId}`, ceo);
    expect(division.tasks).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
    const report = await request<Report>('/api/ceo/dashboard?from=2026-11-01&to=2026-11-30', ceo);
    expect(report.recentTasks).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
    const records = await request<IntegrationTask[]>('/api/ceo/tasks?from=2026-11-01&to=2026-11-30', ceo);
    expect(report.counts.tasks).toBe(records.length);
    for (const status of ['pending', 'on_progress', 'done']) {
      expect(report.byStatus[status]).toBe(records.filter((record) => record.status === status).length);
    }

    const followup = await fixture.retrieve('Sekarang siapa yang mengurus tugas itu?',
      interpretation({ operation: 'pic', target: 'previous_work', workKind: 'task' }), initial.context);
    expect(followup).toMatchObject({ kind: 'facts', facts: { entity: { id: task.id, name: patch.title },
      picName: 'Hakim', status: 'done', updatedAt: latest.updatedAt,
      tasks: [expect.objectContaining({ id: task.id, title: patch.title, date: patch.date, status: 'done',
        picName: 'Hakim', projectId: destination.id, projectName: `${destination.name} Final`, updatedAt: latest.updatedAt })] } });
    for (const [month, total] of [['10', 0], ['11', 1]] as const) {
      const answer = await fixture.retrieve(`Rekap tugas proyek ${destination.name} Final untuk bulan ${month}.`,
        interpretation({ operation: 'summary', subject: `${destination.name} Final`, workKind: 'project',
          from: `2026-${month}-01`, to: month === '10' ? '2026-10-31' : '2026-11-30' }));
      expect(answer).toMatchObject({ kind: 'facts', facts: { counts: { total, done: total } } });
    }
    const history = await request(`/api/ceo/tasks/${task.id}/history`, ceo);
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ previousStatus: 'pending', status: 'done', actorName: 'Doni' })]));
    const after = await readQueue();
    expect(after).toMatchObject({ title: patch.title, description: patch.description, embedding: null, model: null });
    expect(after.hash).not.toBe(before.hash);
  });

  test('penghapusan SQL membersihkan indeks dan mencegah fakta lama dibaca kembali', async () => {
    // This is database integrity coverage. The product does not expose task/project deletion UI or API.
    const { task } = await fixture.createWork();
    const initial = await fixture.retrieve(`Apa status tugas ${task.title}?`, interpretation({ subject: task.title, workKind: 'task' }));
    expect(initial.kind).toBe('facts');
    await fixture.db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
    expect((await fixture.db.query('SELECT resource_id FROM work_search_embeddings WHERE kind = $1 AND resource_id = $2',
      ['task', task.id])).rows).toEqual([]);
    for (const [prefix, headers] of [['admin', fixture.admin], ['ceo', fixture.ceo]] as const) {
      expect((await fixture.app.inject({ url: `/api/${prefix}/tasks/${task.id}`, headers })).statusCode).toBe(404);
    }
    const answer = await fixture.retrieve('Bagaimana status tugas yang tadi?',
      interpretation({ target: 'previous_work', workKind: 'task' }), initial.context);
    expect(answer.kind).toBe('no_match');
    expect(answer.facts).toBeUndefined();
  });
});
