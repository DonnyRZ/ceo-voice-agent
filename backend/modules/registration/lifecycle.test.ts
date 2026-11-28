import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareAdminFixture } from '../../tests/admin-fixture.js';

describe('resumable registration and final activation', () => {
  let f: Awaited<ReturnType<typeof prepareAdminFixture>>;
  let divisionId: string;
  const mails: { email: string; verificationUrl: string }[] = [];
  const password = 'Resume-' + randomUUID();
  beforeAll(async () => {
    f = await prepareAdminFixture({ sendRegistration: async (mail) => { mails.push(mail); } });
    divisionId = (await f.db.query("SELECT id FROM divisions WHERE status='active' LIMIT 1")).rows[0].id;
  },30000);
  afterAll(async () => { await f?.close(); });
  const save = (email: string, cookie?: string, secret=password, originDevice='mobile') => f.app.inject({
    method:'POST',url:'/api/registration',headers:cookie?{cookie}:{},
    payload:{email,name:'Anggota Resume',divisionId,password:secret,originDevice},
  });
  const cookieOf = (r: {headers: Record<string,unknown>}) => String(r.headers['set-cookie']).split(';')[0];
  const status = async (cookie: string) => (await f.app.inject({url:'/api/registration/status',headers:{cookie}})).json().registration;
  const post = (path: string,cookie: string,payload: object) => f.app.inject({method:'POST',url:'/api/registration/'+path,headers:{cookie},payload});
  async function verify(cookie: string) {
    expect((await post('send-email',cookie,{})).statusCode).toBe(200);
    const token=new URLSearchParams(new URL(mails.at(-1)!.verificationUrl).hash.slice(1)).get('token');
    return post('verify',cookie,{token});
  }
  const accountCount = async (email: string) => (await f.db.query('SELECT FROM "user" WHERE email=$1',[email])).rowCount;

  it('keeps a verified mobile registration private and inactive until the final step',async () => {
    const email='inactive.mobile@egiresources.com';
    const cookie=cookieOf(await save(email));
    expect((await post('complete',cookie,{method:'iphone-confirmed'})).statusCode).toBe(400);
    expect((await verify(cookie)).statusCode).toBe(200);
    expect(await status(cookie)).toMatchObject({verified:true,completed:false,step:'device'});
    expect(await accountCount(email)).toBe(0);
    const login=await f.app.inject({method:'POST',url:'/api/auth/sign-in/email',payload:{email,password}});
    expect(login.statusCode).toBe(401);
    expect((await post('complete',cookie,{method:'iphone-confirmed'})).statusCode).toBe(409);
    expect((await post('progress',cookie,{step:'iphone-open'})).statusCode).toBe(200);
    const completed=await post('complete',cookie,{method:'iphone-confirmed'});
    expect(completed.statusCode).toBe(200);
    expect(completed.json().registration).toMatchObject({completed:true,step:'done'});
    expect(await accountCount(email)).toBe(1);
    const identity=await f.login(email,password);
    expect((await f.app.inject({url:'/api/session',headers:identity})).json().user.role).toBe('member');
  });

  it('resumes after losing browser storage only with matching credentials and retains the saved step',async () => {
    const email='lost.browser@egiresources.com';
    const original=cookieOf(await save(email));
    await verify(original);
    await post('progress',original,{step:'iphone-add'});
    const response=await save(email,undefined,password,'desktop');
    expect(response.statusCode).toBe(201);
    expect(response.json().registration).toMatchObject({verified:true,completed:false,step:'iphone-add',origin_device:'mobile'});
    const resumed=cookieOf(response);
    expect(resumed).not.toBe(original);
    expect(await status(original)).toBeNull();
    expect(await accountCount(email)).toBe(0);
    const unrelated=await save(email,undefined,password+'wrong');
    expect(unrelated.statusCode).toBe(201);
    expect(unrelated.json().registration).toMatchObject({verified:false,step:'verify'});
    expect(await status(resumed)).toMatchObject({verified:true,step:'iphone-add'});
  });

  it('continues its own verified progress without replacing the original password or division',async () => {
    const email='owner.resume@egiresources.com';
    const cookie=cookieOf(await save(email));
    await verify(cookie);
    await post('progress',cookie,{step:'android-wait'});
    const response=await save(email,cookie,password+'new');
    expect(response.statusCode).toBe(201);
    expect(response.json().registration.step).toBe('android-wait');
    const results=await Promise.all([post('complete',cookie,{method:'android-installed'}),post('complete',cookie,{method:'android-installed'})]);
    expect(results.map((r)=>r.statusCode)).toEqual([200,200]);
    expect(await accountCount(email)).toBe(1);
    await f.login(email,password);
  });

  it('recovers a previous-version incomplete registration without deleting or changing its existing member account',async () => {
    const email='legacy.pending@egiresources.com';
    const original=cookieOf(await save(email,undefined,password,'desktop'));
    await verify(original);
    const user=(await f.db.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];
    await f.db.query("UPDATE app_private.member_registrations SET origin_device=NULL,completed_at=NULL,onboarding_step='device',legacy_user_id=$2 WHERE email=$1",[email,user.id]);
    await f.db.query('SELECT app_private.reconcile_incomplete_registrations()');
    const wrong=await save(email,undefined,password+'wrong');
    expect(wrong.statusCode).toBe(201);
    expect(wrong.json().registration).toMatchObject({verified:false,completed:false,step:'verify'});
    const resumed=await save(email);
    expect(resumed.statusCode).toBe(201);
    expect(resumed.json().registration).toMatchObject({completed:false,origin_device:'mobile',step:'device'});
    const cookie=cookieOf(resumed);
    await post('progress',cookie,{step:'iphone-open'});
    expect((await post('complete',cookie,{method:'iphone-confirmed'})).statusCode).toBe(200);
    expect((await f.db.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0].id).toBe(user.id);
    expect(await accountCount(email)).toBe(1);
    await f.login(email,password);
  });

  it('applies an email delivery budget across drafts and preserves the old link when a send is rejected',async () => {
    const email='delivery.budget@egiresources.com';
    const cookies: string[]=[];
    for(let i=0;i<5;i++) cookies.push(cookieOf(await save(email,undefined,password+String(i))));
    for(const cookie of cookies) expect((await post('send-email',cookie,{})).statusCode).toBe(200);
    const before=mails.length;
    await f.db.query("UPDATE app_private.member_registrations SET sent_at=now()-interval '61 seconds' WHERE email=$1",[email]);
    const old=(await f.db.query('SELECT token_hash FROM app_private.member_registrations WHERE email=$1 ORDER BY id',[email])).rows;
    expect((await post('send-email',cookies[0],{})).statusCode).toBe(429);
    expect(mails.length).toBe(before);
    expect((await f.db.query('SELECT token_hash FROM app_private.member_registrations WHERE email=$1 ORDER BY id',[email])).rows).toEqual(old);
  },20000);

  it('finishes legacy desktop recovery atomically and keeps the old claim if completion is blocked',async () => {
    for(const blocked of [false,true]) {
      const email=`legacy.desktop.${blocked}@egiresources.com`;
      const original=cookieOf(await save(email,undefined,password,'desktop'));
      await verify(original);
      const user=(await f.db.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];
      await f.db.query("UPDATE app_private.member_registrations SET origin_device=NULL,completed_at=NULL,onboarding_step='device',legacy_user_id=$2 WHERE email=$1",[email,user.id]);
      await f.db.query('SELECT app_private.reconcile_incomplete_registrations()');
      if(blocked) {
        const archived=(await f.db.query("INSERT INTO divisions(name,status) VALUES ('Bekas divisi pendaftaran','archived') RETURNING id")).rows[0];
        await f.db.query('UPDATE app_private.member_registrations SET division_id=$2 WHERE email=$1',[email,archived.id]);
      }
      const response=await save(email,undefined,password,'desktop');
      expect(response.statusCode).toBe(blocked?409:201);
      if(blocked) {
        expect(await status(original)).toBeNull();
        expect((await f.db.query('SELECT origin_device,completed_at FROM app_private.member_registrations WHERE legacy_user_id=$1',[user.id])).rows[0]).toMatchObject({origin_device:null,completed_at:null});
      }
      else expect(response.json().registration).toMatchObject({completed:true,origin_device:'desktop',step:'done'});
      expect(await accountCount(email)).toBe(1);
    }
  },20000);

  it('gives each newly sent verification link its full lifetime without activating the draft',async () => {
    const email='link.lifetime@egiresources.com';
    const cookie=cookieOf(await save(email));
    await f.db.query("UPDATE app_private.member_registrations SET expires_at=now()+interval '1 hour' WHERE email=$1",[email]);
    expect((await post('send-email',cookie,{})).statusCode).toBe(200);
    const remaining=(await f.db.query('SELECT extract(epoch from expires_at-clock_timestamp())::integer AS seconds FROM app_private.member_registrations WHERE email=$1',[email])).rows[0].seconds;
    expect(remaining).toBeGreaterThan(86390);
    expect(await accountCount(email)).toBe(0);
  });
});
