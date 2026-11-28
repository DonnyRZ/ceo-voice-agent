import { expect, test } from '@playwright/test';
import { mockScreen } from './fixture';
import { capture } from './capture';

const registration={name:'Anggota QA',email:'anggota@egiresources.com',division_id:'division-1',verified:true,
  completed:false,origin_device:'mobile',delivery:'sent',step:'iphone-add',retry_after_seconds:0,sends_remaining:4};

test('onboarding-resume__server-step-after-reopen',async({page},info)=>{
  const fixture=await mockScreen(page,'public');
  fixture.overrides.set('/api/registration/status',{registration});
  await page.goto('/register');
  await expect(page).toHaveURL(/\/onboarding\?step=iphone-add$/);
  await expect(page.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
  await capture(page,info,'onboarding-resume__saved-iphone-step');
  await page.reload();
  await expect(page.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
});

test('onboarding-resume__save-and-completion-errors',async({page},info)=>{
  const fixture=await mockScreen(page,'public');
  fixture.overrides.set('/api/registration/status',{registration:{...registration,step:'device'}});
  let failSave=true,failComplete=true;
  await page.route('**/api/registration/progress',route=>failSave?route.fulfill({status:503,json:{message:'Progres belum dapat disimpan. Coba lagi pada langkah ini.'}}):route.fallback());
  await page.route('**/api/registration/complete',route=>failComplete?route.fulfill({status:503,json:{message:'Registrasi belum dapat diselesaikan. Coba lagi pada langkah ini.'}}):route.fallback());
  await page.goto('/onboarding');
  await page.getByRole('radio',{name:/iPhone/}).click();
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page,info,'onboarding-resume__progress-error');
  failSave=false;
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await page.getByRole('button',{name:'Sudah ditambahkan',exact:true}).click();
  await page.getByRole('button',{name:'Selesai',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page,info,'onboarding-resume__completion-error');
  failComplete=false;
  await page.getByRole('button',{name:'Selesai',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
  await capture(page,info,'onboarding-resume__completed');
  await page.getByRole('button',{name:'Lihat panduan lagi',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pilih perangkat Anda',exact:true})).toBeVisible();
  await capture(page,info,'onboarding-resume__completed-review-guide');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
});

test('onboarding-resume__email-verified-is-not-an-active-account',async({page},info)=>{
  const fixture=await mockScreen(page,'public');
  fixture.overrides.set('/api/registration/status',{registration:{...registration,step:'device'}});
  await page.goto('/register/check-email');
  await expect(page.getByRole('heading',{name:'Email Anda sudah terverifikasi.',exact:true})).toBeVisible();
  await expect(page.getByText('Akun Anggota Divisi Anda sudah aktif.',{exact:true})).toHaveCount(0);
  await capture(page,info,'onboarding-resume__verified-inactive');
  fixture.overrides.set('/api/registration/status',{registration:{...registration,completed:true,step:'done'}});
  await page.reload();
  await expect(page.getByRole('heading',{name:'Registrasi selesai',exact:true})).toBeVisible();
  await capture(page,info,'onboarding-resume__active-after-completion');
});

test('onboarding-resume__standalone-progress-error-and-recovery',async({page},info)=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
  const fixture=await mockScreen(page,'public');
  fixture.overrides.set('/api/registration/status',{registration:{...registration,step:'device'}});
  await page.route('**/api/registration/status',route=>route.fulfill({status:503,json:{message:'Progress unavailable'}}));
  await page.goto('/launch');
  await expect(page.getByRole('heading',{name:'Sesi tidak dapat diperiksa'})).toBeVisible();
  await capture(page,info,'onboarding-resume__standalone-progress-error');
  await page.unroute('**/api/registration/status');
  await page.getByRole('button',{name:'Coba lagi',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Aplikasi sudah terbuka',exact:true})).toBeVisible();
  await capture(page,info,'onboarding-resume__standalone-pending');
});
