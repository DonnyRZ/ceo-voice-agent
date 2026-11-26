import type { FastifyInstance } from 'fastify';
import { ApiError, parseInput, resourceId } from '../../http/api-error.js';
import type { RequireMember } from '../auth/member-access.js';
import { findTask, insertTask, listTasks, taskHistory, updateTask } from './task-repository.js';
import { createTask, editTask, taskFilters } from './task-schema.js';

type TaskPath = { Params: { id: string } };

export function registerTaskRoutes(app: FastifyInstance, requireMember: RequireMember) {
  app.get('/api/tasks', (request) =>
    requireMember(request, ({ db, member }) =>
      listTasks(db, member.divisionId, parseInput(taskFilters, request.query)),
    ),
  );

  app.get<TaskPath>('/api/tasks/:id', (request) =>
    requireMember(request, async ({ db, member }) => {
      const task = await findTask(db, member.divisionId, resourceId(request.params.id));
      if (!task) throw new ApiError(404, 'Tugas tidak ditemukan.');
      return task;
    }),
  );

  app.get<TaskPath>('/api/tasks/:id/history', (request) =>
    requireMember(request, async ({ db, member }) => {
      const id = resourceId(request.params.id);
      const task = await findTask(db, member.divisionId, id);
      if (!task) throw new ApiError(404, 'Tugas tidak ditemukan.');
      return taskHistory(db, id);
    }),
  );

  app.post('/api/tasks', async (request, reply) => {
    const task = await requireMember(request, ({ db, member }) =>
      insertTask(db, member.divisionId, parseInput(createTask, request.body)),
    );
    return reply.code(201).send(task);
  });

  app.patch<TaskPath>('/api/tasks/:id', (request) =>
    requireMember(request, async ({ db, member }) => {
      const id = resourceId(request.params.id);
      const existing = await findTask(db, member.divisionId, id);
      if (!existing) throw new ApiError(404, 'Tugas tidak ditemukan.');
      const input = parseInput(editTask, request.body);
      const task = await updateTask(db, member.divisionId, id, input);
      if (task) return task;

      const current = await findTask(db, member.divisionId, id);
      if (!current) throw new ApiError(404, 'Tugas tidak ditemukan.');
      throw new ApiError(409, 'Tugas sudah diperbarui pengguna lain.', undefined, current);
    }),
  );
}
