import { randomUUID } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { ApiError, parseInput } from '../../http/api-error.js';
import { digest, limitRegistration, readClaim } from './claim.js';
import { registrationProgress } from './progress.js';
import { verificationInput } from './schema.js';

export function registerVerificationRoute(app: FastifyInstance, pool: Pool, config: AppConfig) {
  app.post('/api/registration/verify', async (request) => {
    const { token, password } = parseInput(verificationInput, request.body);
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'verify');
    const claim = readClaim(request, config.APP_ORIGIN);
    const tokenHash = digest(token), ownerHash = claim ? digest(claim) : null;
    const { rows: [context] } = await pool.query<{ requires_password: boolean; password_hash: string | null }>(
      'SELECT * FROM public.registration_verification_context($1, $2)', [tokenHash, ownerHash],
    );
    if (!context) throw invalidLink();
    if (context.requires_password && !password) {
      // A proof challenge must not look like successful verification to an older
      // already-open client during deployment.
      throw new ApiError(428, 'Konfirmasi kata sandi pendaftaran untuk melanjutkan.', { password: 'required' });
    }
    if (context.requires_password) {
      await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'verification-password', tokenHash);
      if (!context.password_hash || !await verifyPassword({ hash: context.password_hash, password: password! })) {
        throw new ApiError(403, 'Kata sandi pendaftaran belum cocok. Periksa kembali isian Anda.', { password: 'Gunakan kata sandi yang diisi saat pendaftaran.' });
      }
    }
    const { rows: [verified] } = await pool.query<{ email: string; origin_device: string | null; same_browser: boolean }>(
      context.requires_password ? 'SELECT * FROM public.confirm_registration_with_password($1,$2,$3,$4,$5)'
        : 'SELECT * FROM public.confirm_member_registration($1,$2,$3,$4)',
      context.requires_password ? [tokenHash, context.password_hash, randomUUID(), randomUUID(), ownerHash]
        : [tokenHash, randomUUID(), randomUUID(), ownerHash],
    );
    if (!verified) throw invalidLink();
    request.log.info({ event: 'registration.verified', originDevice: verified.origin_device, sameBrowser: verified.same_browser }, 'Email pendaftaran terverifikasi');
    // Email verification in another browser does not grant that browser private progress or a login session.
    return { ...verified, registration: verified.same_browser && claim ? await registrationProgress(pool, digest(claim)) : null };
  });
}

function invalidLink() {
  return new ApiError(400, 'Tautan tidak berlaku atau sudah digunakan. Periksa email terbaru atau mulai pendaftaran kembali.');
}
