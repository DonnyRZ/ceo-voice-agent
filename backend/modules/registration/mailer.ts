import { readFile } from 'node:fs/promises';
import { smtpTransport } from '../mail/transport.js';
import { registrationEmail } from './email-template.js';

export type SendRegistration = (message: { email: string; verificationUrl: string }) => Promise<void>;

export function createRegistrationMailer(source: NodeJS.ProcessEnv = process.env): SendRegistration {
  return async ({ email, verificationUrl }) => {
    const { transport, from } = smtpTransport(source);
    const delivery = await transport.sendMail({
      from: { name: 'Ruang Kerja', address: from }, to: email,
      subject: 'Verifikasi email Ruang Kerja',
      html: registrationEmail(verificationUrl),
      attachments: [{ filename: 'ruang-kerja.png', cid: 'ruang-kerja-brand',
        content: await readFile(new URL('../mail/assets/brand.png', import.meta.url)) }],
      text: ['Verifikasi email perusahaan untuk mengaktifkan akun Anggota Divisi Anda.',
        verificationUrl, 'Tautan berlaku 24 jam dan hanya dapat digunakan satu kali.',
        'Abaikan email ini jika Anda tidak membuat akun.'].join('\n\n'),
    });
    if (delivery.accepted.length !== 1 || delivery.rejected.length) throw new Error('Verifikasi gagal dikirim.');
  };
}
