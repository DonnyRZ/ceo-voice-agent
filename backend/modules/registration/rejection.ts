import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';

const messages: Record<string, string> = {
  division_unavailable: 'Divisi yang dipilih sudah tidak aktif. Muat ulang daftar divisi lalu pilih kembali.',
  account_exists: 'Email ini sudah memiliki akun. Silakan masuk menggunakan akun Anda.',
  registration_incomplete: 'Pendaftaran sebelumnya belum selesai. Gunakan email dan kata sandi pendaftaran sebelumnya untuk melanjutkan.',
  invitation_exists: 'Email ini sudah memiliki undangan. Selesaikan aktivasi melalui tautan undangan terbaru.',
  send_limit: 'Batas pengiriman verifikasi tercapai. Gunakan email terakhir atau coba lagi setelah pendaftaran kedaluwarsa.',
  save_conflict: 'Pendaftaran belum dapat disimpan. Coba lagi.',
};

export async function registrationRejection(client: PoolClient, email: string, division: string, ownerHash: string) {
  const { rows: [failure] } = await client.query<{ reason: string }>(
    'SELECT public.registration_rejection_reason($1, $2, $3) AS reason', [email, division, ownerHash],
  );
  return { reason: failure.reason, error: new ApiError(409, messages[failure.reason] ?? messages.save_conflict) };
}
