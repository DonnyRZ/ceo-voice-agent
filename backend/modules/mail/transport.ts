import nodemailer from 'nodemailer';
import { z } from 'zod';

const smtpEnvironment = z.object({
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.email(),
});

export function smtpTransport(source: NodeJS.ProcessEnv) {
  const result = smtpEnvironment.safeParse(source);
  if (!result.success) throw new Error('Konfigurasi SMTP belum lengkap.');
  const config = result.data;
  const secure = config.SMTP_SECURE ? config.SMTP_SECURE === 'true' : config.SMTP_PORT === 465;
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(config.SMTP_HOST);
  return {
    from: config.SMTP_FROM,
    transport: nodemailer.createTransport({
      host: config.SMTP_HOST, port: config.SMTP_PORT, secure, requireTLS: !secure && !loopback,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
      connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000,
      disableFileAccess: true, disableUrlAccess: true,
    }),
  };
}
