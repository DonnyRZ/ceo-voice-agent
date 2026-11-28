import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { ApiError, parseInput } from '../../http/api-error.js';
import { digest, limitRegistration, newSecret, readClaim, writeClaim } from './claim.js';
import type { SendRegistration } from './mailer.js';
import { registrationInput, verificationInput, type RegistrationStatus } from './schema.js';

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
    const { rows: [registration] } = await pool.query<RegistrationStatus>(
      'SELECT * FROM public.registration_status($1)', [digest(claim)],
    );
    return { registration: registration ?? null };
  });

  app.post('/api/registration', async (request, reply) => {
    const input = parseInput(registrationInput, request.body);
    const domain = input.email.slice(input.email.lastIndexOf('@') + 1);
    if (!config.REGISTRATION_EMAIL_DOMAINS.includes(domain)) {
      throw new ApiError(400, 'Gunakan email perusahaan yang diizinkan.', { email: 'Domain email belum diizinkan.' });
    }
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'register');
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'email', input.email);
    const claim = readClaim(request, config.APP_ORIGIN) ?? newSecret();
    const token = newSecret();
    const passwordHash = await hashPassword(input.password);
    const { rows: [saved] } = await pool.query<{ id: string | null }>(
      'SELECT public.save_member_registration($1, $2, $3, $4, $5, $6) AS id',
      [input.email, input.name, input.divisionId, passwordHash, digest(token), digest(claim)],
    );
    if (!saved.id) throw new ApiError(409, 'Pendaftaran belum dapat diproses. Periksa divisi, gunakan tautan email yang sudah dikirim, atau masuk jika sudah memiliki akun.');
    writeClaim(reply, claim, config.APP_ORIGIN);
    const delivery = await deliver(saved.id, input.email, token);
    return reply.code(201).send({ delivery });
  });

  app.post('/api/registration/resend', async (request) => {
    parseInput(verificationInput.pick({}).strict(), request.body ?? {});
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'resend');
    const claim = readClaim(request, config.APP_ORIGIN);
    if (!claim) throw new ApiError(400, 'Mulai pendaftaran terlebih dahulu.');
    const token = newSecret();
    const { rows: [registration] } = await pool.query<{ id: string; email: string }>(
      'SELECT * FROM public.resend_member_registration($1, $2)', [digest(claim), digest(token)],
    );
    if (!registration) throw new ApiError(429, 'Tunggu minimal satu menit sebelum mengirim ulang. Jika tautan kedaluwarsa, daftar kembali.');
    return { delivery: await deliver(registration.id, registration.email, token) };
  });

  app.post('/api/registration/verify', async (request) => {
    const { token } = parseInput(verificationInput, request.body);
    await limitRegistration(pool, request, config.BETTER_AUTH_SECRET, 'verify');
    const { rows: [verified] } = await pool.query<{ email: string | null }>(
      'SELECT public.verify_member_registration($1, $2, $3) AS email', [digest(token), randomUUID(), randomUUID()],
    );
    if (!verified.email) throw new ApiError(400, 'Tautan tidak berlaku atau sudah digunakan. Periksa email terbaru atau mulai pendaftaran kembali.');
    return { email: verified.email };
  });
}
