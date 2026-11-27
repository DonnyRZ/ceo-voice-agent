import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, parseInput } from '../../http/api-error.js';
import type { Auth } from '../auth/auth.js';
import type { RequireSession } from '../auth/session-access.js';

const passwordChange = z.object({
  currentPassword: z.string().min(1, 'Masukkan kata sandi saat ini.').max(128),
  newPassword: z.string().min(8, 'Kata sandi minimal 8 karakter.').max(128, 'Kata sandi maksimal 128 karakter.'),
}).strict().refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
  path: ['newPassword'], error: 'Gunakan kata sandi baru yang berbeda.',
});

export function registerAccountRoutes(app: FastifyInstance, requireSession: RequireSession, auth: Auth) {
  app.post('/api/account/password', async (request, reply) => {
    const input = parseInput(passwordChange, request.body);
    // Finish the domain transaction before Better Auth needs the adapter pool.
    // Better Auth rechecks the session and the session-create hook checks active access.
    await requireSession(request, async () => undefined);
    const response = await auth.api.changePassword({
      headers: fromNodeHeaders(request.headers),
      body: { ...input, revokeOtherSessions: true },
      asResponse: true,
    });
    if (!response.ok) {
      const error = await response.json() as { code?: string };
      if (error.code === 'INVALID_PASSWORD') throw new ApiError(400, 'Kata sandi saat ini tidak sesuai.');
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(401, 'Masuk kembali sebelum mengubah kata sandi.');
      }
      throw new ApiError(response.status >= 500 ? 503 : 400, 'Kata sandi belum berhasil diperbarui. Coba lagi.');
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    request.log.info({ event: 'account.password_changed' }, 'Kata sandi akun diperbarui');
    return { success: true };
  });
}
