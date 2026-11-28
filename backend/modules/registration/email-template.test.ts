import { describe, expect, it } from 'vitest';
import { registrationEmail } from './email-template.js';

describe('verification email button', () => {
  it('links the button directly to the HTTPS confirmation page including its fragment token', () => {
    const url = 'https://ceo-stage.egiresources.com/register/verify#token=' + 'a'.repeat(64);
    const html = registrationEmail(url);
    expect(html).toContain('href="' + url + '"');
    expect(html).toMatch(/<a[^>]+>Verifikasi email<\/a>/);
    expect(html).toContain('cid:ruang-kerja-brand');
  });
  it('escapes URL attribute delimiters and rejects unsafe protocols or non-local plaintext origins', () => {
    expect(registrationEmail('https://example.test/register/verify?a=1&b=2#token=abc')).toContain('?a=1&amp;b=2');
    expect(() => registrationEmail('javascript:alert(1)')).toThrow();
    expect(() => registrationEmail('http://example.test/register/verify')).toThrow();
  });
});
