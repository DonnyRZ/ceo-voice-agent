import type { PoolClient } from 'pg';
import type { WorkStatus } from '../work-status.js';
import type { ProjectEdit, ProjectInput } from './project-schema.js';

export type Project = {
  id: string;
  name: string;
  description: string;
  status: WorkStatus;
  version: number;
  updatedAt: Date;
};

const projectFields = 'id, name, description, status, version, updated_at AS "updatedAt"';

export async function listProjects(db: PoolClient, divisionId: string) {
  const { rows } = await db.query<Project>(`
    SELECT ${projectFields} FROM projects
    WHERE division_id = $1 ORDER BY name, id
  `, [divisionId]);
  return rows;
}

export async function findProject(db: PoolClient, divisionId: string, id: string) {
  const { rows: [project] } = await db.query<Project>(`
    SELECT ${projectFields} FROM projects
    WHERE division_id = $1 AND id = $2
  `, [divisionId, id]);
  return project;
}

export async function insertProject(db: PoolClient, divisionId: string, input: ProjectInput) {
  const { rows: [project] } = await db.query<Project>(`
    INSERT INTO projects (division_id, name, description, status)
    VALUES ($1, $2, $3, $4)
    RETURNING ${projectFields}
  `, [divisionId, input.name, input.description, input.status ?? 'pending']);
  return project;
}

export async function updateProject(
  db: PoolClient,
  divisionId: string,
  id: string,
  input: ProjectEdit,
) {
  const { rows: [project] } = await db.query<Project>(`
    UPDATE projects
    SET name = $3, description = COALESCE($4, description), status = COALESCE($5, status),
        version = version + 1, updated_at = now()
    WHERE division_id = $1 AND id = $2 AND version = $6
    RETURNING ${projectFields}
  `, [divisionId, id, input.name, input.description ?? null, input.status ?? null, input.version]);
  return project;
}
