import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError } from '../../../http/api-error.js';
import { requireAssignableDivision, requireUser, validateVersion } from './repository.js';
import type { InvitationInput } from './schema.js';

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

async function lockEmail(db: PoolClient, email: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1172026))', [email]);
}

async function ensureRecipientAvailable(db: PoolClient, email: string, omitId?: string) {
  const { rows: [found] } = await db.query<{ account: boolean; invitation: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM "user" WHERE email = $1) AS account,
      EXISTS (
        SELECT 1 FROM invitations
        WHERE email = $1 AND expires_at > clock_timestamp()
          AND status IN ('pending', 'failed')
          AND ($2::uuid IS NULL OR id <> $2)
      ) AS invitation
  `, [email, omitId ?? null]);
  if (found.account) throw new ApiError(409, 'Email sudah terdaftar.', { email: 'Email sudah terdaftar.' });
  if (found.invitation) {
    throw new ApiError(409, 'Undangan untuk email ini sudah tersedia.', {
      email: 'Gunakan undangan yang sudah tersedia.',
    });
  }
  await db.query(`
    UPDATE invitations SET status = 'expired', version = version + 1, updated_at = clock_timestamp()
    WHERE email = $1 AND expires_at <= clock_timestamp()
      AND status IN ('pending', 'failed') AND ($2::uuid IS NULL OR id <> $2)
  `, [email, omitId ?? null]);
}

export async function inviteUser(db: PoolClient, input: InvitationInput) {
  await requireAssignableDivision(db, input.divisionId);
  await lockEmail(db, input.email);
  await ensureRecipientAvailable(db, input.email);
  const dispatch = newToken();
  const { rows: [record] } = await db.query<{ id: string }>(`
    INSERT INTO invitations (email, role, division_id, token_hash, expires_at)
    VALUES ($1, $2, $3, $4, clock_timestamp() + interval '24 hours') RETURNING id
  `, [input.email, input.role, input.divisionId, dispatch.hash]);
  return { invite: await requireUser(db, record.id), ...dispatch };
}

export async function retryInvite(db: PoolClient, id: string, version?: number) {
  const initial = await requireUser(db, id);
  if (initial.kind !== 'invitation') throw new ApiError(404, 'Undangan tidak ditemukan.');
  await requireAssignableDivision(db, initial.divisionId);
  await lockEmail(db, initial.email);
  await db.query("SELECT id FROM invitations WHERE id = $1 AND status <> 'activated' FOR UPDATE", [id]);
  const invite = await requireUser(db, id);
  validateVersion(invite, version);
  if (invite.status === 'revoked') {
    throw new ApiError(409, 'Undangan ini sudah dicabut.', undefined, invite);
  }
  await ensureRecipientAvailable(db, invite.email, id);
  const dispatch = newToken();
  await db.query(`
    UPDATE invitations SET token_hash = $2, expires_at = clock_timestamp() + interval '24 hours',
      status = 'pending', version = version + 1, updated_at = clock_timestamp()
    WHERE id = $1
  `, [id, dispatch.hash]);
  return { invite: await requireUser(db, id), ...dispatch };
}

export type InvitationDispatch = Awaited<ReturnType<typeof inviteUser>>;
