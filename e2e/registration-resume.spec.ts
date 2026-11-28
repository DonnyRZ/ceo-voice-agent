import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { requireLocalSmtp } from './admin/mailpit';
import { expectInactive, loginRecovered } from './registration-resume-session';

// Failure injection must intercept the request. Real SW/offline tests remain in registration.spec.ts.
test.use({ serviceWorkers: 'block' });

async function verifiedMobile(page: Page) {
  requireLocalSmtp();
  const email='resume-'+randomUUID().slice(0,12)+'@egiresources.com';
  const password='Resume-'+randomUUID();
  const options=await (await page.request.get('/api/registration/divisions')).json();
  expect((await page.request.post('/api/registration',{data:{name:'Anggota Resume QA',email,password,
    divisionId:options.divisions[0].id,originDevice:'mobile'}})).status()).toBe(201);
  expect((await page.request.post('/api/registration/send-email',{data:{}})).status()).toBe(200);
  const mailbox=new URL(process.env.E2E_MAILPIT_URL??'http://127.0.0.1:8025');
  let messageId: string|undefined;
  await expect.poll(async()=>{
    const data=await (await fetch(new URL('/api/v1/search?'+new URLSearchParams({query:'to:'+email}),mailbox))).json();
    messageId=data.messages?.[0]?.ID;return !!messageId;
  }).toBe(true);
  const message=await (await fetch(new URL('/api/v1/message/'+messageId,mailbox))).json();
  const link=(message.Text.match(/https?:\/\/[^\s<>]+/g)??[]).map((url:string)=>new URL(url)).find((url:URL)=>url.pathname==='/register/verify');
  const token=new URLSearchParams(link.hash.slice(1)).get('token');
  expect((await page.request.post('/api/registration/verify',{data:{token}})).status()).toBe(200);
  return {email,password};
}

test('form reload retains only non-secret fields before saving',async({page})=>{
  await page.goto('/register');
  const email='form-'+randomUUID().slice(0,12)+'@egiresources.com';
  await page.getByLabel('Nama lengkap',{exact:true}).fill('Nama Form Reload');
  await page.getByLabel('Email perusahaan',{exact:true}).fill(email);
  await page.getByLabel('Divisi',{exact:true}).selectOption({label:'IT'});
  const password='Never-cache-'+randomUUID();
  await page.getByLabel('Kata sandi',{exact:true}).fill(password);
  await page.getByLabel('Konfirmasi kata sandi',{exact:true}).fill(password);
  await page.reload();
  await expect(page.getByLabel('Nama lengkap',{exact:true})).toHaveValue('Nama Form Reload');
  await expect(page.getByLabel('Email perusahaan',{exact:true})).toHaveValue(email);
  await expect(page.getByLabel('Kata sandi',{exact:true})).toHaveValue('');
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
  expect(stored).not.toContain(password);
  expect(stored).not.toContain('password');
});

test('server progress survives reload, closed tabs and credential-based recovery on another browser',async({page,browser},info)=>{
  const {email,password}=await verifiedMobile(page);
  await page.goto('/register');
  await expect(page).toHaveURL(/\/onboarding\?step=device$/);
  await page.getByRole('radio',{name:/iPhone/}).click();
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
  await page.goto('/onboarding?step=iphone-share');
  await expect(page.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
  const originalContext=page.context();
  await page.close();
  const reopened=await originalContext.newPage();
  await reopened.goto('/register');
  await expect(reopened.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
  const other=await browser.newContext({viewport:info.project.name==='mobile'?{width:1440,height:900}:{width:390,height:844}});
  try {
    const recovered=await other.newPage();
    await recovered.goto(new URL('/register',reopened.url()).href);
    await recovered.getByLabel('Nama lengkap',{exact:true}).fill('Input baru tidak menimpa profil');
    await recovered.getByLabel('Email perusahaan',{exact:true}).fill(email);
    await recovered.getByLabel('Divisi',{exact:true}).selectOption({label:'IT'});
    await recovered.getByLabel('Kata sandi',{exact:true}).fill(password);
    await recovered.getByLabel('Konfirmasi kata sandi',{exact:true}).fill(password);
    await recovered.getByRole('button',{name:'Simpan dan lanjut',exact:true}).click();
    await expect(recovered.getByRole('heading',{name:'6. Ketuk Tambah'})).toBeVisible();
    expect((await (await recovered.request.get('/api/registration/status')).json()).registration).toMatchObject({name:'Anggota Resume QA',step:'iphone-add',completed:false});
    expect((await (await reopened.request.get('/api/registration/status')).json()).registration).toBeNull();
    await expectInactive(recovered,email,password);
    await recovered.getByRole('button',{name:'Sudah ditambahkan',exact:true}).click();
    await recovered.getByRole('button',{name:'Selesai',exact:true}).click();
    await expect(recovered.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
    await recovered.reload();
    await expect(recovered.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
    await recovered.goto(new URL('/onboarding?step=iphone-open',recovered.url()).href);
    await expect(recovered.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
    await recovered.getByRole('button',{name:'Lihat panduan lagi',exact:true}).click();
    await expect(recovered.getByRole('heading',{name:'Pilih perangkat Anda',exact:true})).toBeVisible();
    expect((await (await recovered.request.get('/api/registration/status')).json()).registration).toMatchObject({completed:true,step:'done'});
    await recovered.reload();
    await expect(recovered.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
    await recovered.goto(new URL('/register',recovered.url()).href);
    await expect(recovered.getByRole('heading',{name:'Registrasi selesai',exact:true})).toBeVisible();
    await recovered.goto(new URL('/login',recovered.url()).href);
    await loginRecovered(recovered,email,password);
    await expect(recovered.getByRole('heading',{name:'Dashboard Divisi',exact:true})).toBeVisible();
  } finally {await other.close();}
});

test('failed progress and completion requests retain the last saved step and cannot activate an account',async({page})=>{
  const {email,password}=await verifiedMobile(page);
  await page.goto('/onboarding');
  await page.route('**/api/registration/progress',route=>route.fulfill({status:503,json:{message:'Progres belum dapat disimpan. Server sedang sibuk.'}}));
  await page.getByRole('radio',{name:/iPhone/}).click();
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Progres belum dapat disimpan. Server sedang sibuk.');
  expect((await (await page.request.get('/api/registration/status')).json()).registration.step).toBe('device');
  await page.unroute('**/api/registration/progress');
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  await page.getByRole('button',{name:'Sudah ditambahkan',exact:true}).click();
  await page.route('**/api/registration/complete',route=>route.fulfill({status:503,json:{message:'Registrasi belum dapat diselesaikan. Coba lagi pada langkah ini.'}}));
  await page.getByRole('button',{name:'Selesai',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get('/api/registration/status')).json()).registration).toMatchObject({step:'iphone-open',completed:false});
  await expectInactive(page,email,password);
  await page.unroute('**/api/registration/complete');
  await page.getByRole('button',{name:'Selesai',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
});

test('opening an installed application resumes pending registration before allowing login',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
  const {email,password}=await verifiedMobile(page);
  await page.goto('/launch');
  await expect(page.getByRole('heading',{name:'Aplikasi sudah terbuka',exact:true})).toBeVisible();
  await expectInactive(page,email,password);
  await page.getByRole('button',{name:'Lanjutkan ke Masuk',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginRecovered(page,email,password);
  await expect(page.getByRole('heading',{name:'Dashboard Divisi',exact:true})).toBeVisible();
});
