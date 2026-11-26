import nodemailer from 'nodemailer';
import { z } from 'zod';

export type SendInvitation = (message: {
  email: string;
  activationUrl: string;
}) => Promise<void>;

const smtpEnvironment = z.object({
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.email(),
});

export function createInvitationMailer(source: NodeJS.ProcessEnv = process.env): SendInvitation {
  const result = smtpEnvironment.safeParse(source);
  if (!result.success) {
    return async () => {
      throw new Error('Konfigurasi SMTP undangan belum lengkap.');
    };
  }

  const config = result.data;
  const secure = config.SMTP_SECURE ? config.SMTP_SECURE === 'true' : config.SMTP_PORT === 465;
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(config.SMTP_HOST);
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure,
    requireTLS: !secure && !loopback,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return async ({ email, activationUrl }) => {
    const delivery = await transport.sendMail({
      from: { name: 'Ruang Kerja', address: config.SMTP_FROM },
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
