import type { FastifyReply, FastifyRequest } from 'fastify';
import { expect, it, vi } from 'vitest';
import { readClaim, writeClaim } from './claim.js';

it('protects HTTPS progress with a host-prefix cookie and rejects a parent-domain/plain-cookie substitute', () => {
  const header = vi.fn();
  const secret = 'a'.repeat(64);
  writeClaim({ header } as unknown as FastifyReply, secret, 'https://ceo.egiresources.com');
  const value = header.mock.calls[0][1] as string;
  expect(value).toContain('__Host-rk_registration=');
  expect(value).toContain('; Path=/;');
  expect(value).toContain('; HttpOnly; SameSite=Strict; Secure');
  expect(value).not.toMatch(/; Domain=/i);
  expect(readClaim({ headers: { cookie: 'rk_registration=' + secret } } as FastifyRequest, 'https://ceo.egiresources.com')).toBeUndefined();
  expect(readClaim({ headers: { cookie: '__Host-rk_registration=' + secret } } as FastifyRequest, 'https://ceo.egiresources.com')).toBe(secret);
});

it('supports local HTTP tests while rejecting malformed claims', () => {
  expect(readClaim({ headers: { cookie: 'rk_registration=not-a-capability' } } as FastifyRequest, 'http://localhost:5173')).toBeUndefined();
  expect(readClaim({ headers: { cookie: 'rk_registration=' + 'b'.repeat(64) } } as FastifyRequest, 'http://localhost:5173')).toBe('b'.repeat(64));
});
