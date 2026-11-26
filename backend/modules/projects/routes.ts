import type { FastifyInstance } from 'fastify';
import { ApiError, parseInput, resourceId } from '../../http/api-error.js';
import type { RequireMember } from '../auth/member-access.js';
import { findProject, insertProject, listProjects, updateProject } from './project-repository.js';
import { createProject, editProject } from './project-schema.js';

type ProjectPath = { Params: { id: string } };

export function registerProjectRoutes(app: FastifyInstance, requireMember: RequireMember) {
  app.get('/api/projects', (request) =>
    requireMember(request, ({ db, member }) => listProjects(db, member.divisionId)),
  );

  app.get<ProjectPath>('/api/projects/:id', (request) =>
    requireMember(request, async ({ db, member }) => {
      const project = await findProject(db, member.divisionId, resourceId(request.params.id));
      if (!project) throw new ApiError(404, 'Proyek tidak ditemukan.');
      return project;
    }),
  );

  app.post('/api/projects', async (request, reply) => {
    const project = await requireMember(request, ({ db, member }) =>
      insertProject(db, member.divisionId, parseInput(createProject, request.body)),
    );
    return reply.code(201).send(project);
  });

  app.patch<ProjectPath>('/api/projects/:id', (request) =>
    requireMember(request, async ({ db, member }) => {
      const id = resourceId(request.params.id);
      const input = parseInput(editProject, request.body);
      const project = await updateProject(db, member.divisionId, id, input);
      if (project) return project;

      const current = await findProject(db, member.divisionId, id);
      if (!current) throw new ApiError(404, 'Proyek tidak ditemukan.');
      throw new ApiError(409, 'Proyek sudah diperbarui pengguna lain.', undefined, current);
    }),
  );
}
