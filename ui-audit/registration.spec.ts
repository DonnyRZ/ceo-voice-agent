import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';

const registration = { name: 'Anggota QA', email: 'anggota@egiresources.com', division_id: 'division-1', verified: false, delivery: 'sent', origin_device: 'mobile', retry_after_seconds: 0, sends_remaining: 4, completed: false, step: 'verify' };
async function fill(page: import('@playwright/test').Page) {
  await page.getByLabel('Nama lengkap', { exact: true }).fill('Anggota QA');
  await page.getByLabel('Email perusahaan', { exact: true }).fill('anggota@egiresources.com');
  await page.getByLabel('Divisi', { exact: true }).selectOption('division-1');
  await page.getByLabel('Kata sandi', { exact: true }).fill('visual-password-7');
  await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill('visual-password-7');
}
test('registration__validation-submit-error-and-navigation', async ({ page }, info) => {
  const fixture = await mockScreen(page, 'public');
  fixture.overrides.set('/api/registration/status', { registration: null });
  const save = await mutation(page, '/api/registration');
  await page.goto('/register');
  await fill(page);
  await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Simpan dan lanjut', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Konfirmasi kata sandi belum sama.');
  await capture(page, info, 'registration__password-mismatch');
  await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill('visual-password-7');
  await page.getByRole('button', { name: 'Tampilkan kata sandi', exact: true }).click();
  await capture(page, info, 'registration__password-visible');
  for (const status of [400, 409, 429, 503]) {
    save.set(status, { message: status === 400 ? 'Gunakan email perusahaan yang diizinkan.' : 'Pendaftaran belum dapat diproses. Coba lagi.' });
    await page.getByRole('button', { name: 'Simpan dan lanjut', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await capture(page, info, 'registration__submit-error-' + status);
  }
  save.set(0);
  await page.getByRole('button', { name: 'Simpan dan lanjut', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
  await capture(page, info, 'registration__submitting');
  fixture.overrides.set('/api/registration/status', { registration });
  await save.release(201, { registration: { ...registration, delivery: 'not_sent', origin_device: info.project.name === 'mobile' ? 'mobile' : 'desktop' } });
  await expect(page).toHaveURL(/\/register\/check-email$/);
  await capture(page, info, 'registration__saved');
});
test('registration__email-pending-delivery-failed-resend-and-verified', async ({ page }, info) => {
  const fixture = await mockScreen(page, 'public');
  fixture.overrides.set('/api/registration/status', { registration: { ...registration, delivery: 'failed' } });
  const resend = await mutation(page, '/api/registration/send-email');
  await page.goto('/register/check-email');
  await expect(page.getByRole('heading', { name: 'Email belum terkirim', exact: true })).toBeVisible();
  await capture(page, info, 'registration__email-delivery-failed');
  resend.set(429, { message: 'Tunggu minimal satu menit sebelum mengirim ulang.' });
  await page.getByRole('button', { name: 'Kirim ulang email' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Tunggu minimal satu menit' })).toBeVisible();
  await capture(page, info, 'registration__resend-throttled');
  resend.set(0);
  await page.getByRole('button', { name: 'Kirim ulang email' }).click();
  await expect(page.getByRole('button', { name: 'Mengirim…' })).toBeDisabled();
  await capture(page, info, 'registration__resending');
  fixture.overrides.set('/api/registration/status', { registration });
  await resend.release(200, { delivery: 'sent', registration });
  await expect(page.getByRole('heading', { name: 'Periksa email Anda' })).toBeVisible();
  await capture(page, info, 'registration__email-pending');
});
test('registration__verify-error-pending-and-success', async ({ page }, info) => {
  await mockScreen(page, 'public');
  const verify = await mutation(page, '/api/registration/verify');
  await page.goto('/register/verify#token=' + 'b'.repeat(64));
  await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, 'registration__verify-error');
  verify.set(0);
  await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Memverifikasi…' })).toBeDisabled();
  await capture(page, info, 'registration__verifying');
  await verify.release(200, { email: registration.email, origin_device: 'mobile', same_browser: false, registration: null });
  await expect(page.getByRole('heading', { name: 'Email terverifikasi', exact: true })).toBeVisible();
  await capture(page, info, 'registration__verified');
});
test('onboarding__platform-selection-and-manual-guide', async ({ page }, info) => {
  await mockScreen(page, 'public');
  await page.goto('/onboarding');
  await expect(page.getByRole('button', { name: 'Lanjutkan', exact: true })).toBeDisabled();
  const android = page.getByRole('radio', { name: /Android/ });
  await android.focus();
  await android.press('Space');
  await expect(android).toBeChecked();
  await capture(page, info, 'onboarding__android-selected');
  await android.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /iPhone/ })).toBeChecked();
  await capture(page, info, 'onboarding__iphone-selected');
  await page.getByRole('radio', { name: /Android/ }).click();
  await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click();
  await page.getByRole('button', { name: 'Panduan pemasangan manual' }).click();
  await capture(page, info, 'onboarding__android-manual');
  await page.getByRole('button', { name: 'Periksa setelah memasang' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('.install-wait img')).toHaveCount(0);
  await capture(page, info, 'onboarding__checking-without-logo');
});

test('onboarding__native-event-states-and-installed-opening', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'getInstalledRelatedApps', { configurable: true,
      value: async () => (window as Window & { installedFixture?: boolean }).installedFixture
        ? [{ platform: 'webapp', url: location.origin + '/manifest.webmanifest', id: location.origin + '/' }] : [],
    });
  });
  const fixture = await mockScreen(page, 'public');
  fixture.overrides.set('/api/registration/status',{registration:{...registration,verified:true,step:'android-install'}});
  await page.goto('/onboarding?step=android-install');
  async function prompt(outcome: 'accepted' | 'dismissed', failure = false) {
    await page.evaluate(({ outcome, failure }) => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: () => failure ? Promise.reject(new Error('fixture failure')) : Promise.resolve(),
        userChoice: Promise.resolve({ outcome }),
      });
      window.dispatchEvent(event);
    }, { outcome, failure });
    await page.getByRole('button', { name: 'Pasang aplikasi', exact: true }).click();
  }
  await prompt('dismissed');
  await expect(page.getByRole('status')).toHaveText('Pemasangan dibatalkan');
  await capture(page, info, 'onboarding__cancelled');
  await page.getByRole('button', { name: 'Kembali ke panduan' }).click();
  await prompt('accepted', true);
  await expect(page.getByRole('status')).toHaveText('Pemasangan belum dapat dimulai');
  await capture(page, info, 'onboarding__native-failed');
  await page.getByRole('button', { name: 'Kembali ke panduan' }).click();
  await prompt('accepted');
  await expect(page.getByRole('status')).toHaveText('Menunggu konfirmasi pemasangan');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('heading', { name: 'Aplikasi siap dibuka' })).toHaveCount(0);
  await expect(page.locator('.install-wait img')).toHaveCount(0);
  await capture(page, info, 'onboarding__accepted-not-installed');
  await page.evaluate(() => {
    (window as Window & { installedFixture?: boolean }).installedFixture = true;
    window.dispatchEvent(new Event('appinstalled'));
  });
  await expect(page.getByRole('heading', { name: 'Aplikasi siap dibuka' })).toBeVisible();
  await capture(page, info, 'onboarding__installed-evidence');
  await page.getByRole('button', { name: 'Lihat cara membuka' }).click();
  await capture(page, info, 'onboarding__installed-manual-opening');
  await expect(page.getByRole('link', { name: 'Buka Ruang Kerja' })).toHaveAttribute('href', '/launch?source=onboarding');
});

test('onboarding__standalone-session-error-and-retry', async ({ page }, info) => {
  await page.route('**/api/registration/status', (route) => route.fulfill({json:{registration:null}}));
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await page.route('**/api/session', (route) => route.fulfill({ status: 503, json: { message: 'Offline fixture' } }));
  await page.goto('/launch');
  await expect(page.getByRole('heading', { name: 'Sesi tidak dapat diperiksa' })).toBeVisible();
  await capture(page, info, 'onboarding__standalone-session-error');
  await page.route('**/api/session', (route) => route.fulfill({ status: 401, json: {} }));
  await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
