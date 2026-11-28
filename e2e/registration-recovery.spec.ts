import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import { legacyRegistration,verificationLink } from './registration-recovery-fixture';
import { expectInactive,loginRecovered } from './registration-resume-session';
import { capture } from '../ui-audit/capture';

test.use({serviceWorkers:'block'});
for(const knownMobile of [false,true]) test(`unfinished legacy account recovers with a new email proof, known mobile=${knownMobile}`,async({page,browser},info)=>{
  const old=await legacyRegistration(page,knownMobile);
  const base=new URL(page.url()==='about:blank'?process.env.E2E_BASE_URL??'http://localhost:5173':page.url());
  const other=await browser.newContext({viewport:info.project.name==='mobile'?{width:390,height:844}:{width:1440,height:900}});
  try {
    const claimant=await other.newPage(),newPassword=randomUUID();
    await claimant.goto(new URL('/register',base).href);
    await claimant.getByLabel('Nama lengkap',{exact:true}).fill('Nama baru tidak menimpa profil');
    await claimant.getByLabel('Email perusahaan',{exact:true}).fill(old.email);
    await claimant.getByLabel('Divisi',{exact:true}).selectOption({label:'IT'});
    await claimant.getByLabel('Kata sandi',{exact:true}).fill(newPassword);
    await claimant.getByLabel('Konfirmasi kata sandi',{exact:true}).fill(newPassword);
    await claimant.getByRole('button',{name:'Simpan dan lanjut',exact:true}).click();
    await expect(claimant).toHaveURL(/\/register\/check-email$/);
    await expect(claimant.getByRole('button',{name:'Kirim email verifikasi',exact:true})).toBeVisible();
    await capture(claimant,info,'legacy-recovery__verification-required');
    await expectInactive(claimant,old.email,old.password);
    await claimant.getByRole('button',{name:'Kirim email verifikasi',exact:true}).click();
    await expect(claimant.getByRole('heading',{name:'Periksa email Anda',exact:true})).toBeVisible();
    const link=await verificationLink(old.email);
    await page.goto(link);
    await page.getByRole('button',{name:'Verifikasi email',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Konfirmasi pendaftaran',exact:true})).toBeVisible();
    await capture(page,info,'legacy-recovery__cross-browser-password');
    await page.getByLabel('Kata sandi pendaftaran',{exact:true}).fill('wrong-recovery-password');
    await page.getByRole('button',{name:'Verifikasi dan lanjutkan',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Kata sandi pendaftaran belum cocok');
    await page.getByLabel('Kata sandi pendaftaran',{exact:true}).fill(newPassword);
    await page.getByRole('button',{name:'Verifikasi dan lanjutkan',exact:true}).click();
    await expect(page.getByRole('heading',{name:/^(Email terverifikasi|Registrasi selesai)$/})).toBeVisible();
    await capture(page,info,'legacy-recovery__cross-browser-verified');
    await claimant.goto(new URL('/register/check-email',base).href);
    const mobile=knownMobile||info.project.name==='mobile';
    if(mobile) {
      await expect(claimant.getByRole('heading',{name:'Email Anda sudah terverifikasi.',exact:true})).toBeVisible();
      await capture(claimant,info,'legacy-recovery__verified-incomplete');
      await claimant.reload();
      await claimant.getByRole('link',{name:'Lanjutkan',exact:true}).click();
      if(!knownMobile) {
        await claimant.getByRole('radio',{name:/iPhone/}).click();
        await claimant.getByRole('button',{name:'Lanjutkan',exact:true}).click();
        await claimant.getByRole('button',{name:'Lanjutkan',exact:true}).click();
      }
      await expect(claimant.getByRole('heading',{name:'6. Ketuk Tambah',exact:true})).toBeVisible();
      await capture(claimant,info,'legacy-recovery__restored-progress');
      await expectInactive(claimant,old.email,newPassword);
      await claimant.getByRole('button',{name:'Sudah ditambahkan',exact:true}).click();
      await claimant.getByRole('button',{name:'Selesai',exact:true}).click();
      await expect(claimant.getByRole('heading',{name:'Panduan selesai',exact:true})).toBeVisible();
    } else await expect(claimant.getByRole('heading',{name:'Registrasi selesai',exact:true})).toBeVisible();
    await capture(claimant,info,'legacy-recovery__completed');
    await claimant.goto(new URL('/login',base).href);
    await loginRecovered(claimant,old.email,newPassword);
    await expect(claimant.getByRole('heading',{name:'Dashboard Divisi',exact:true})).toBeVisible();
    expect((await (await claimant.request.get('/api/session')).json()).user.id).toBe(old.id);
  } finally {await other.close();}
});
