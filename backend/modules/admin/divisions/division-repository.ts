import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from '../../../http/api-error.js';
import type { DivisionEdit, DivisionFilters, DivisionInput, DivisionStatus } from './division-schema.js';

export type AdminDivision = Required<DivisionInput> & {
  id: string;
  status: DivisionStatus;
  memberCount: number;
  version: number;
  updatedAt: Date;
};

export type DivisionMember = { id: string; name: string; email: string };

const divisionSelect = `
  SELECT d.id, d.name, d.code, d.description, d.status, d.version, d.updated_at AS "updatedAt",
    (SELECT count(*)::integer FROM account_access a
     WHERE a.division_id = d.id AND a.role = 'member' AND a.state = 'active' AND a.registration_complete) AS "memberCount"
  FROM divisions d
`;

export async function listDivisions(db: PoolClient, filters: DivisionFilters) {
  const { rows } = await db.query<AdminDivision>(`
    ${divisionSelect}
    WHERE ($1::text IS NULL OR d.status = $1)
      AND ($2::text IS NULL OR strpos(lower(d.name), lower($2)) > 0 OR strpos(lower(d.code), lower($2)) > 0)
    ORDER BY lower(d.name), d.id
  `, [filters.status, filters.search]);
  return rows;
}

export async function findDivision(db: PoolClient, id: string) {
  const { rows: [division] } = await db.query<AdminDivision>(`${divisionSelect} WHERE d.id = $1`, [id]);
  if (!division) throw new ApiError(404, 'Divisi tidak ditemukan.');
  return division;
}

export async function listDivisionMembers(db: PoolClient, id: string) {
  const { rows } = await db.query<DivisionMember>(`
    SELECT u.id, u.name, u.email FROM account_access a
    JOIN "user" u ON u.id = a.user_id
    WHERE a.division_id = $1 AND a.role = 'member' AND a.state = 'active' AND a.registration_complete
    ORDER BY lower(u.name), u.id
  `, [id]);
  return rows;
}

function generatedCode(name: string) {
  const prefix = name.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${prefix || 'DIVISI'}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function throwDivisionWriteError(error: unknown): never {
  if (error instanceof Error && 'code' in error && error.code === '23505') {
    const codeConflict = 'constraint' in error && error.constraint === 'divisions_code_unique';
    const message = codeConflict ? 'Kode divisi sudah digunakan.' : 'Nama divisi sudah digunakan.';
    throw new ApiError(409, message, codeConflict ? { code: message } : { name: message });
  }
  throw error;
}

export async function insertDivision(db: PoolClient, input: DivisionInput) {
  try {
    const { rows: [saved] } = await db.query<{ id: string }>(`
      INSERT INTO divisions (name, code, description) VALUES ($1, $2, $3)
      RETURNING id
    `, [input.name, input.code ?? generatedCode(input.name), input.description]);
    return findDivision(db, saved.id);
  } catch (error) {
    throwDivisionWriteError(error);
  }
}

export async function saveDivision(db: PoolClient, id: string, input: DivisionEdit) {
  try {
    const result = await db.query(`
      UPDATE divisions SET name = $2, code = coalesce($3, code), description = $4,
        version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $5 AND status = 'active'
    `, [id, input.name, input.code, input.description, input.version]);
    const current = await findDivision(db, id);
    if (result.rowCount === 0) {
      throw new ApiError(409, current.status === 'archived' ? 'Divisi sudah diarsipkan.' : 'Divisi sudah diperbarui pengguna lain.', undefined, current);
    }
    return current;
  } catch (error) {
    throwDivisionWriteError(error);
  }
}

export async function archiveDivision(db: PoolClient, id: string, version?: number) {
  await db.query('SELECT id FROM divisions WHERE id = $1 FOR UPDATE', [id]);
  const current = await findDivision(db, id);
  if (version !== undefined && current.version !== version) {
    throw new ApiError(409, 'Divisi sudah diperbarui pengguna lain.', undefined, current);
  }
  if (current.status === 'archived') return { division: current };

  const members = await listDivisionMembers(db, id);
  if (members.length > 0) return { blocked: { message: `${current.name} masih memiliki anggota aktif.`, members } };

  await db.query(`
    UPDATE divisions SET status = 'archived', version = version + 1, updated_at = now()
    WHERE id = $1
  `, [id]);
  return { division: await findDivision(db, id) };
}
