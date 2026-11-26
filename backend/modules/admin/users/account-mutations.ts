import type { PoolClient } from 'pg';
import { ApiError } from '../../../http/api-error.js';
import { requireAssignableDivision, requireUser, validateVersion } from './repository.js';
import type { UserEdit } from './schema.js';

export async function updateAccount(db: PoolClient, actorId: string, id: string, input: UserEdit) {
  const user = await requireUser(db, id);
  validateVersion(user, input.version);
  if (user.kind !== 'account' || user.status !== 'active') {
    throw new ApiError(409, 'Pengaturan ini tersedia untuk akun aktif.', undefined, user);
  }
  if (id === actorId && input.role !== 'superadmin') {
    throw new ApiError(409, 'Anda tidak dapat mengubah peran Superadmin sendiri.');
  }
  await requireAssignableDivision(db, input.divisionId);
  const name = input.name ?? user.name;
  if (name !== user.name) {
    await db.query('UPDATE "user" SET name = $2, "updatedAt" = now() WHERE id = $1', [id, name]);
  }
  if (input.divisionId) {
    await db.query(`
      INSERT INTO members (id, division_id, name) VALUES ($1, $2, $3)
      ON CONFLICT (division_id, id) DO UPDATE SET name = EXCLUDED.name
      WHERE members.name IS DISTINCT FROM EXCLUDED.name
    `, [id, input.divisionId, name]);
  }
  await db.query(`
    UPDATE account_access SET role = $2, division_id = $3,
      version = version + 1, updated_at = clock_timestamp()
    WHERE user_id = $1
  `, [id, input.role, input.divisionId]);
  if (user.role !== input.role || user.divisionId !== input.divisionId) {
    await db.query('DELETE FROM session WHERE "userId" = $1', [id]);
  }
  return requireUser(db, id);
}

export async function revokeUser(db: PoolClient, actorId: string, id: string, version?: number) {
  if (id === actorId) throw new ApiError(409, 'Anda tidak dapat mencabut akses sendiri.');
  // An invitation can be activated while another request attempts to revoke it.
  const user = await requireUser(db, id);
  if (user.kind === 'invitation') {
    await db.query("SELECT id FROM invitations WHERE id = $1 AND status <> 'activated' FOR UPDATE", [id]);
    const invitation = await requireUser(db, id);
    validateVersion(invitation, version);
    if (invitation.status === 'revoked') return invitation;
    await db.query(`
      UPDATE invitations SET status = 'revoked', version = version + 1, updated_at = clock_timestamp()
      WHERE id = $1
    `, [id]);
  } else {
    validateVersion(user, version);
    if (user.status !== 'revoked') {
      await db.query(`
        UPDATE account_access SET state = 'revoked', version = version + 1, updated_at = clock_timestamp()
        WHERE user_id = $1
      `, [id]);
    }
    await db.query('DELETE FROM session WHERE "userId" = $1', [id]);
  }
  return requireUser(db, id);
}
