import { sessionHome } from '../../shared/session';
import type { SessionUser } from '../../shared/types';

export function loginDestination(user: SessionUser, requested: unknown) {
  const safe = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')
    && !requested.includes('\\') && !['/login', '/activate', '/superadmin'].includes(requested);
  const area = safe ? requested.split('/')[1] : '';
  const role = area === 'admin' ? 'superadmin' : area === 'ceo' ? 'ceo' : 'member';
  return safe && role === user.role ? requested : sessionHome(user.role);
}
