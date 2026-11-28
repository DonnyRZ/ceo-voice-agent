import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, type Page } from '@playwright/test';
import { requireLocalSmtp } from './admin/mailpit';

export async function verificationLink(email:string) {
  requireLocalSmtp();
  const mailbox=new URL(process.env.E2E_MAILPIT_URL??'http://127.0.0.1:8025');
  let id:string|undefined;
  await expect.poll(async()=>{
    const data=await (await fetch(new URL('/api/v1/search?'+new URLSearchParams({query:'to:'+email}),mailbox))).json();
    id=data.messages?.[0]?.ID;return !!id;
  }).toBe(true);
  const message=await (await fetch(new URL('/api/v1/message/'+id,mailbox))).json();
  return (message.Text.match(/https?:\/\/[^\s<>]+/g)??[]).find((link:string)=>new URL(link).pathname==='/register/verify') as string;
}

export async function legacyRegistration(page:Page,knownMobile:boolean) {
  requireLocalSmtp();
  const email='legacy-browser-'+randomUUID()+'@egiresources.com',password=randomUUID();
  const options=await (await page.request.get('/api/registration/divisions')).json();
  const divisionId=options.divisions[0].id;
  expect((await page.request.post('/api/registration',{data:{email,password,name:'Nama asli tersimpan',divisionId,originDevice:'desktop'}})).status()).toBe(201);
  expect((await page.request.post('/api/registration/send-email',{data:{}})).status()).toBe(200);
  const token=new URLSearchParams(new URL(await verificationLink(email)).hash.slice(1)).get('token');
  expect((await page.request.post('/api/registration/verify',{data:{token}})).status()).toBe(200);
  const db=new Pool({connectionString:process.env.DATABASE_ADMIN_URL});
  try {
    const user=(await db.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];
    await db.query("UPDATE app_private.member_registrations SET completed_at=NULL,legacy_user_id=$2,origin_device=$3,onboarding_step=$4 WHERE email=$1",[email,user.id,knownMobile?'mobile':null,knownMobile?'iphone-add':'device']);
    await db.query('SELECT app_private.reconcile_incomplete_registrations()');
    return {email,password,id:user.id};
  } finally {await db.end();}
}
