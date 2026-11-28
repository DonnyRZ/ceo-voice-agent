import type { Pool, PoolClient } from 'pg';
import type { RegistrationStatus } from './schema.js';

export async function registrationProgress(database: Pool | PoolClient, ownerHash: string) {
  const { rows: [registration] } = await database.query<RegistrationStatus>(`
    SELECT status.*, context.* FROM public.registration_status($1) status
    CROSS JOIN public.registration_context($1) context
  `, [ownerHash]);
  return registration ? { ...registration, retry_after_seconds: registration.resend_after
    ? Math.max(0, Math.ceil((new Date(registration.resend_after).getTime() - Date.now()) / 1000)) : 0 } : null;
}
