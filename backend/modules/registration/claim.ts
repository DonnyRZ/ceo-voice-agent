import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';

const cookieName = (origin: string) => origin.startsWith('https:') ? '__Host-rk_registration' : 'rk_registration';
export const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const newSecret = () => randomBytes(32).toString('hex');

export function readClaim(request: FastifyRequest, origin: string) {
  const name = cookieName(origin);
  const value = request.headers.cookie?.split(';').map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(name + '='))?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function writeClaim(reply: FastifyReply, secret: string, origin: string) {
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const path = secure ? '/' : '/api/registration';
  reply.header('set-cookie', cookieName(origin) + '=' + secret + '; Path=' + path + '; Max-Age=604800; HttpOnly; SameSite=Strict' + secure);
}

export async function limitRegistration(pool: Pool | PoolClient, request: FastifyRequest, secret: string, action: string, identity?: string) {
  // Ignore caller-controlled forwarding headers; the server's trusted peer is the key.
  const key = createHmac('sha256', secret).update(action + ':' + (identity ?? request.ip)).digest('hex');
  const { rows: [result] } = await pool.query<{ allowed: boolean }>(
    'SELECT public.registration_rate_allowed($1, $2, $3) AS allowed',
    [key, action.startsWith('email') ? 5 : 100, action.startsWith('email') ? 600 : 60],
  );
  if (!result.allowed) throw new ApiError(429, 'Terlalu banyak percobaan. Coba lagi dalam beberapa menit.');
}
