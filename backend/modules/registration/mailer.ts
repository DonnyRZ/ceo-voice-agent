import { smtpTransport } from '../mail/transport.js';

export type SendRegistration = (message: { email: string; verificationUrl: string }) => Promise<void>;

export function createRegistrationMailer(source: NodeJS.ProcessEnv = process.env): SendRegistration {
  return async ({ email, verificationUrl }) => {
    const { transport, from } = smtpTransport(source);
    const delivery = await transport.sendMail({
      from: { name: 'Ruang Kerja', address: from }, to: email,
      subject: 'Verifikasi email Ruang Kerja',
      text: ['Verifikasi email perusahaan untuk mengaktifkan akun Anggota Divisi Anda.',
        verificationUrl, 'Tautan berlaku 24 jam dan hanya dapat digunakan satu kali.',
        'Abaikan email ini jika Anda tidak membuat akun.'].join('\n\n'),
    });
    if (delivery.accepted.length !== 1 || delivery.rejected.length) throw new Error('Verifikasi gagal dikirim.');
  };
}
