import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { ApiError } from '../../http/api-error.js';
import { limitRegistration } from './claim.js';
import { registrationProgress } from './progress.js';

export async function claimDelivery(pool: Pool, request: FastifyRequest, secret: string, ownerHash: string, tokenHash: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const draft = await registrationProgress(client, ownerHash);
    if (!draft || draft.verified) throw new ApiError(400, 'Mulai atau lanjutkan pendaftaran yang belum diverifikasi.');
    // One persistent email budget across browser drafts; failed cooldown checks roll this back.
    await limitRegistration(client, request, secret, 'email-delivery', draft.email);
    const { rows: [registration] } = await client.query<{ id: string; email: string }>(
      'SELECT * FROM public.resend_member_registration($1, $2)', [ownerHash, tokenHash],
    );
    if (!registration) throw new ApiError(429, 'Tunggu minimal satu menit sebelum mengirim ulang. Jika tautan kedaluwarsa, daftar kembali.');
    await client.query('COMMIT');
    return registration;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
