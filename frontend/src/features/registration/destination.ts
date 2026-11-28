import type { Registration } from './api';

export function registrationDestination(registration: Registration) {
  return registration.verified && !registration.completed && registration.origin_device !== 'desktop'
    ? '/onboarding?step=' + encodeURIComponent(registration.step)
    : '/register/check-email';
}
