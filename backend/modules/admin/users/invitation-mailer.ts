import { smtpTransport } from '../../mail/transport.js';

export type SendInvitation = (message: {
  email: string;
  activationUrl: string;
}) => Promise<void>;

export function createInvitationMailer(source: NodeJS.ProcessEnv = process.env): SendInvitation {
  return async ({ email, activationUrl }) => {
    const { transport, from } = smtpTransport(source);
    const delivery = await transport.sendMail({
      from: { name: 'Ruang Kerja', address: from },
      to: email,
      subject: 'Undangan bergabung ke Ruang Kerja',
      text: [
        'Anda diundang bergabung ke Ruang Kerja.',
        'Buka tautan berikut untuk mengaktifkan akun dan membuat kata sandi.',
        activationUrl,
        'Tautan aktivasi hanya dapat digunakan satu kali.',
      ].join('\n\n'),
    });
    if (delivery.accepted.length !== 1 || delivery.rejected.length > 0) {
      throw new Error('Server email menolak penerima undangan.');
    }
  };
}
