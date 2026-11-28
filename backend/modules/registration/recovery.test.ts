import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareAdminFixture } from '../../tests/admin-fixture.js';

describe('legacy registration recovery with fresh email proof',()=>{
  let f: Awaited<ReturnType<typeof prepareAdminFixture>>;
  let divisionId: string;
  const mails: {email:string;verificationUrl:string}[]=[];
  beforeAll(async()=>{
    f=await prepareAdminFixture({sendRegistration:async mail=>{mails.push(mail);}});
    divisionId=(await f.db.query("SELECT id FROM divisions WHERE status='active' LIMIT 1")).rows[0].id;
  },30000);
  afterAll(async()=>{await f?.close();});
  const cookie=(r:{headers:Record<string,unknown>})=>String(r.headers['set-cookie']).split(';')[0];
  const post=(path:string,claim:string,data:object)=>f.app.inject({method:'POST',url:'/api/registration'+path,headers:claim?{cookie:claim}:{},payload:data});
  const save=(email:string,password:string,claim='',originDevice='mobile')=>post('',claim,{email,password,name:'Nama permintaan baru',divisionId,originDevice});
  async function send(claim:string){
    expect((await post('/send-email',claim,{})).statusCode).toBe(200);
    return new URLSearchParams(new URL(mails.at(-1)!.verificationUrl).hash.slice(1)).get('token');
  }
  const progress=async(claim:string)=>(await f.app.inject({url:'/api/registration/status',headers:{cookie:claim}})).json().registration;
  async function legacy(){
    const email='legacy-'+randomUUID()+'@egiresources.com',password=randomUUID();
    const original=cookie(await save(email,password,'','desktop'));
    expect((await post('/verify',original,{token:await send(original)})).statusCode).toBe(200);
    const {rows:[user]}=await f.db.query('SELECT id FROM "user" WHERE email=$1',[email]);
    const session=await f.login(email,password);
    await f.db.query("UPDATE app_private.member_registrations SET completed_at=NULL,origin_device='mobile',onboarding_step='iphone-add',legacy_user_id=$2 WHERE email=$1",[email,user.id]);
    await f.db.query('SELECT app_private.reconcile_incomplete_registrations()');
    return {email,password,original,id:user.id,session};
  }
  it('reconciles old accounts, revokes sessions and preserves IDs and roles',async()=>{
    const old=await legacy();
    expect((await f.app.inject({url:'/api/session',headers:old.session})).statusCode).toBe(401);
    expect((await f.db.query('SELECT registration_complete FROM account_access WHERE user_id=$1',[old.id])).rows[0].registration_complete).toBe(false);
    expect((await f.db.query('SELECT count(*)::integer AS n FROM session WHERE "userId"=$1',[old.id])).rows[0].n).toBe(0);
    const again=await f.db.query('SELECT app_private.reconcile_incomplete_registrations() AS n');
    expect(again.rows[0].n).toBe(0);
    expect((await f.db.query('SELECT role,division_id FROM account_access WHERE user_id=$1',[old.id])).rows[0]).toMatchObject({role:'member',division_id:divisionId});
  });
  it('recovers a mismatched legacy credential using email, preserving progress until final activation',async()=>{
    const old=await legacy(),newPassword=randomUUID();
    const request=await save(old.email,newPassword);
    expect(request.statusCode).toBe(201);
    const claimant=cookie(request);
    expect(await progress(claimant)).toMatchObject({verified:false,step:'verify',completed:false});
    expect((await post('/complete',claimant,{method:'iphone-confirmed'})).statusCode).toBe(400);
    const token=await send(claimant);
    const verified=await post('/verify',claimant,{token});
    expect(verified.json()).toMatchObject({same_browser:true,registration:{verified:true,step:'iphone-add',completed:false}});
    expect(await progress(old.original)).toBeNull();
    expect((await f.app.inject({method:'POST',url:'/api/auth/sign-in/email',payload:{email:old.email,password:old.password}})).statusCode).toBe(401);
    expect((await post('/verify',claimant,{token})).statusCode).toBe(400);
    await post('/progress',claimant,{step:'iphone-open'});
    expect((await post('/complete',claimant,{method:'iphone-confirmed'})).statusCode).toBe(200);
    expect((await progress(claimant)).completed).toBe(true);
    const identity=await f.login(old.email,newPassword);
    expect((await f.app.inject({url:'/api/session',headers:identity})).json().user.id).toBe(old.id);
    expect((await f.db.query('SELECT count(*)::integer AS n FROM "user" WHERE email=$1',[old.email])).rows[0].n).toBe(1);
    const blocked=await save(old.email,randomUUID());
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain('sudah memiliki akun');
  },15000);
  it('requires proof after invalidating a legacy browser claim, without exposing saved progress',async()=>{
    const old=await legacy();
    const pending=await save(old.email,randomUUID(),old.original);
    expect(pending.statusCode).toBe(201);
    expect(pending.json().registration).toMatchObject({verified:false,step:'verify'});
    expect(await progress(old.original)).toMatchObject({verified:false,step:'verify'});
    const claim=cookie(pending),token=await send(claim);
    const fromOtherBrowser=await post('/verify','',{token});
    expect(fromOtherBrowser.statusCode).toBe(403);
    expect(await progress(claim)).toMatchObject({verified:false,step:'verify'});
    expect((await post('/verify',claim,{token})).statusCode).toBe(200);
    expect(await progress(claim)).toMatchObject({verified:true,step:'iphone-add'});
  });
  it('recovers expired legacy progress without deleting its canonical record',async()=>{
    const old=await legacy();
    await f.db.query("UPDATE app_private.member_registrations SET expires_at=now()-interval '1 hour' WHERE email=$1",[old.email]);
    const pending=await save(old.email,randomUUID());
    expect(pending.statusCode).toBe(201);
    const claim=cookie(pending);
    expect((await post('/verify',claim,{token:await send(claim)})).statusCode).toBe(200);
    expect(await progress(claim)).toMatchObject({verified:true,step:'iphone-add',completed:false});
    expect((await f.db.query('SELECT count(*)::integer AS n FROM app_private.member_registrations WHERE legacy_user_id=$1',[old.id])).rows[0].n).toBe(1);
  });
  it('cannot recover a legitimately revoked account or replace a completed account',async()=>{
    const old=await legacy();
    await f.db.query("UPDATE account_access SET state='revoked',version=version+1 WHERE user_id=$1",[old.id]);
    const revoked=await save(old.email,randomUUID());
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json().message).toContain('dinonaktifkan');
    const email='complete-'+randomUUID()+'@egiresources.com',password=randomUUID();
    const claim=cookie(await save(email,password,'','desktop'));
    expect((await post('/verify',claim,{token:await send(claim)})).statusCode).toBe(200);
    expect((await save(email,randomUUID())).statusCode).toBe(409);
  },15000);
});
