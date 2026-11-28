import type { PoolClient } from 'pg';
import { digest, newSecret } from './claim.js';
import { registrationProgress } from './progress.js';

// Called within the save transaction: a rejected replacement keeps the original draft valid.
export async function prepareDraft(client: PoolClient, claim: string, email: string, origin: 'mobile' | 'desktop') {
  const previous = await registrationProgress(client, digest(claim));
  if (!previous) return { claim, origin };
  if (previous.email === email) return { claim: previous.verified ? newSecret() : claim, origin: previous.origin_device ?? origin };
  await client.query('SELECT public.retire_registration_draft($1)', [digest(claim)]);
  return { claim: newSecret(), origin: !previous.verified && previous.origin_device ? previous.origin_device : origin };
}
