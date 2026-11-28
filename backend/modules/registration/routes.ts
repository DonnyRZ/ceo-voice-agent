import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { ApiError, parseInput } from '../../http/api-error.js';
import { digest, limitRegistration, newSecret, readClaim, writeClaim } from './claim.js';
import type { SendRegistration } from './mailer.js';
import { registrationInput, verificationInput } from './schema.js';
import { registrationProgress } from './progress.js';
import { prepareDraft } from './draft.js';

export function registerRegistrationRoutes(
  app: FastifyInstance, pool: Pool, config: AppConfig, send: SendRegistration,
) {
  async function deliver(id: string, email: string, token: string) {
    let delivery = 'sent';
    try {
      await send({ email, verificationUrl: config.APP_ORIGIN + '/register/verify#token=' + token });
    } catch {
      delivery = 'failed';
      // No email address, token, credential, or SMTP response is written to logs.
      app.log.warn({ registrationId: id }, 'Email verifikasi belum terkirim');
    }
    await pool.query('SELECT public.member_registration_delivery($1, $2, $3)', [id, digest(token), delivery]);
    return delivery;
  }

  app.get('/api/registration/divisions', async () => {
    const { rows } = await pool.query('SELECT * FROM public.registration_divisions()');
    return { divisions: rows, emailDomains: config.REGISTRATION_EMAIL_DOMAINS };
  });

  app.get('/api/registration/status', async (request) => {
    const claim = readClaim(request, config.APP_ORIGIN);
    if (!claim) return { registration: null };
    return { registration: await registrationProgress(pool, digest(claim)) };
  });

  app.post('/api/registration', async (request, reply) => {
    const input = parseInput(registrationInput, request.body);
    const domain = input.email.slice(input.email.lastIndexOf('@') + 1);
    if (!config.REGISTRATION_EMAIL_DOMAINS.includes(domain)) {
      throw new ApiError(400, 'Gunakan email perusahaan yang diizinkan.', { email: 'Domain email belum diizinkan.' });
    }
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'register');
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'email', input.email);
    let claim = readClaim(request, config.APP_ORIGIN) ?? newSecret();
    const passwordHash = await hashPassword(input.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draft = await prepareDraft(client, claim, input.email, input.originDevice);
      claim = draft.claim;
      const { rows: [saved] } = await client.query<{ id: string | null }>(
        'SELECT public.save_member_registration($1, $2, $3, $4, $5, $6) AS id',
        [input.email, input.name, input.divisionId, passwordHash, null, digest(claim)],
      );
      if (!saved.id) throw new ApiError(409, 'Pendaftaran belum dapat diproses. Periksa divisi, gunakan browser pendaftaran semula, atau masuk jika sudah memiliki akun.');
      await client.query('SELECT public.capture_registration_origin($1, $2)', [digest(claim), draft.origin]);
      const registration = await registrationProgress(client, digest(claim));
      await client.query('COMMIT');
      writeClaim(reply, claim, config.APP_ORIGIN);
      return reply.code(201).send({ registration });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.post('/api/registration/send-email', async (request) => {
    parseInput(verificationInput.pick({}).strict(), request.body ?? {});
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'resend');
    const claim = readClaim(request, config.APP_ORIGIN);
    if (!claim) throw new ApiError(400, 'Mulai pendaftaran terlebih dahulu.');
    const token = newSecret();
    const { rows: [registration] } = await pool.query<{ id: string; email: string }>(
      'SELECT * FROM public.resend_member_registration($1, $2)', [digest(claim), digest(token)],
    );
    if (!registration) throw new ApiError(429, 'Tunggu minimal satu menit sebelum mengirim ulang. Jika tautan kedaluwarsa, daftar kembali.');
    const delivery = await deliver(registration.id, registration.email, token);
    return { delivery, registration: await registrationProgress(pool, digest(claim)) };
  });

  app.post('/api/registration/verify', async (request) => {
    const { token } = parseInput(verificationInput, request.body);
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'verify');
    const claim = readClaim(request, config.APP_ORIGIN);
    const { rows: [verified] } = await pool.query<{ email: string; origin_device: string | null; same_browser: boolean }>(
      'SELECT * FROM public.confirm_member_registration($1, $2, $3, $4)',
      [digest(token), randomUUID(), randomUUID(), claim ? digest(claim) : null],
    );
    if (!verified) throw new ApiError(400, 'Tautan tidak berlaku atau sudah digunakan. Periksa email terbaru atau mulai pendaftaran kembali.');
    return { ...verified, registration: verified.same_browser && claim
      ? await registrationProgress(pool, digest(claim)) : null };
  });
}
