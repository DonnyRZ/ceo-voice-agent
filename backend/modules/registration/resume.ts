import { verifyPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { digest, newSecret } from './claim.js';
import { registrationProgress } from './progress.js';
import { ApiError } from '../../http/api-error.js';

export async function resumeRegistration(client: PoolClient, claim: string, email: string, password: string, origin: string) {
  const own = await registrationProgress(client, digest(claim));
  if (own?.email === email && (!own.verified || own.completed)) return own.verified ? { claim, registration: own } : null;
  const { rows } = await client.query<{ id: string; password_hash: string; legacy: boolean }>(
    'SELECT * FROM public.registration_resume_candidates($1)', [email],
  );
  if (own?.email === email && own.verified && !rows.some((candidate) => candidate.legacy)) return { claim, registration: own };
  for (const candidate of rows) {
    if (!await verifyPassword({ hash: candidate.password_hash, password })) continue;
    const resumedClaim = newSecret();
    const { rows: [result] } = await client.query<{ resumed: boolean }>(
      'SELECT public.resume_member_registration($1, $2, $3, $4) AS resumed',
      [candidate.id, candidate.password_hash, digest(resumedClaim), origin],
    );
    if (result.resumed) {
      let registration = await registrationProgress(client, digest(resumedClaim));
      if (registration?.verified && registration.origin_device === 'desktop' && !registration.completed) {
        const { rows: [completed] } = await client.query<{ email: string | null }>(
          'SELECT public.complete_member_registration($1, $2, $3) AS email', [digest(resumedClaim), randomUUID(), randomUUID()],
        );
        if (!completed.email) throw new ApiError(409, 'Registrasi belum dapat diselesaikan. Periksa divisi atau status akun.');
        registration = await registrationProgress(client, digest(resumedClaim));
      }
      return { claim: resumedClaim, registration };
    }
  }
  return null;
}
