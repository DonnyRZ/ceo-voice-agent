import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { ApiError, parseInput } from '../../http/api-error.js';
import { digest, readClaim, limitRegistration } from './claim.js';
import { completionInput, progressInput } from './schema.js';
import { registrationProgress } from './progress.js';

export function registerOnboardingRoutes(app: FastifyInstance, pool: Pool, config: AppConfig) {
  app.post('/api/registration/progress', async (request) => {
    const { step } = parseInput(progressInput, request.body);
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'progress');
    const claim = readClaim(request, config.APP_ORIGIN);
    if (!claim) throw new ApiError(400, 'Lanjutkan dari browser pendaftaran Anda.');
    const { rows: [result] } = await pool.query<{ saved: boolean }>(
      'SELECT public.save_registration_step($1, $2) AS saved', [digest(claim), step],
    );
    if (!result.saved) throw new ApiError(409, 'Progres belum dapat disimpan. Periksa status pendaftaran.');
    return { registration: await registrationProgress(pool, digest(claim)) };
  });
  app.post('/api/registration/complete', async (request) => {
    const { method } = parseInput(completionInput, request.body);
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'complete');
    const claim = readClaim(request, config.APP_ORIGIN);
    const current = claim ? await registrationProgress(pool, digest(claim)) : null;
    if (!claim || !current?.verified) throw new ApiError(400, 'Verifikasi email terlebih dahulu.');
    const valid = current.completed || (method === 'iphone-confirmed' ? current.step === 'iphone-open'
      : method === 'standalone' || ['android-install','android-wait'].includes(current.step));
    if (!valid) throw new ApiError(409, 'Selesaikan panduan pemasangan terlebih dahulu.');
    if (method === 'standalone' && !current.completed) await pool.query('SELECT public.save_registration_step($1, $2)', [digest(claim), 'android-install']);
    const { rows: [result] } = await pool.query<{ email: string | null }>(
      'SELECT public.complete_member_registration($1, $2, $3) AS email', [digest(claim), randomUUID(), randomUUID()],
    );
    if (!result.email) throw new ApiError(409, 'Registrasi belum dapat diselesaikan. Periksa divisi atau status akun.');
    request.log.info({ event: 'registration.completed', method }, 'Registrasi selesai');
    return { registration: await registrationProgress(pool, digest(claim)) };
  });
}
