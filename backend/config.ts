import { z } from 'zod';

export const applicationOrigin = z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin);

const environment = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  APP_ORIGIN: applicationOrigin,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
});

export function readConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = environment.safeParse({ ...source, API_PORT: source.API_PORT ?? source.PORT });
  if (!parsed.success) {
    const fields = parsed.error.issues.map(({ path }) => path.join('.')).join(', ');
    throw new Error(`Periksa konfigurasi server: ${fields}`);
  }
  return parsed.data;
}

export type AppConfig = ReturnType<typeof readConfig>;
