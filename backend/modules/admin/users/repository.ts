import type { PoolClient } from 'pg';
import { ApiError } from '../../../http/api-error.js';
import type { AccountRole, AccountStatus, UserFilters } from './schema.js';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  divisionId: string | null;
  divisionName: string | null;
  status: AccountStatus;
  kind: 'account' | 'invitation';
  version: number;
  updatedAt: Date;
};

const records = `
  SELECT access.user_id AS id, profile.name, profile.email, access.role,
         access.division_id AS "divisionId", division.name AS "divisionName",
         access.state::text AS status, 'account' AS kind, access.version, access.updated_at AS "updatedAt"
  FROM account_access access
  JOIN "user" profile ON profile.id = access.user_id
  LEFT JOIN divisions division ON division.id = access.division_id
  UNION ALL
  SELECT invite.id::text, '' AS name, invite.email, invite.role, invite.division_id, division.name,
         CASE
           WHEN invite.status IN ('pending', 'failed') AND invite.expires_at <= statement_timestamp()
           THEN 'expired' ELSE invite.status::text
         END, 'invitation', invite.version, invite.updated_at
  FROM invitations invite
  LEFT JOIN divisions division ON division.id = invite.division_id
  WHERE invite.status <> 'activated'
`;

export async function listUsers(db: PoolClient, filters: UserFilters) {
  const { rows } = await db.query<AdminUser>(`
    SELECT * FROM (${records}) AS entries
    WHERE ($1::text IS NULL OR strpos(lower(name || ' ' || email), lower($1)) > 0)
      AND ($2::account_role IS NULL OR role = $2)
      AND ($3::uuid IS NULL OR "divisionId" = $3)
      AND ($4::text IS NULL OR status = $4)
    ORDER BY "updatedAt" DESC, email, id
  `, [filters.search, filters.role, filters.divisionId, filters.status]);
  return rows;
}

export async function requireUser(db: PoolClient, id: string) {
  const { rows: [user] } = await db.query<AdminUser>(`
    SELECT * FROM (${records}) AS entries WHERE id = $1
  `, [id]);
  if (!user) throw new ApiError(404, 'Pengguna tidak ditemukan.');
  return user;
}

export function validateVersion(user: AdminUser, version?: number) {
  if (version !== undefined && user.version !== version) {
    throw new ApiError(409, 'Data pengguna sudah diperbarui. Tinjau versi terbaru.', undefined, user);
  }
}

export async function requireAssignableDivision(db: PoolClient, divisionId: string | null) {
  if (!divisionId) return;
  const result = await db.query(`
    SELECT id FROM divisions WHERE id = $1 AND status = 'active' FOR SHARE
  `, [divisionId]);
  if (result.rowCount === 0) {
    throw new ApiError(400, 'Pilih divisi yang aktif.', { divisionId: 'Pilih divisi yang aktif.' });
  }
}
