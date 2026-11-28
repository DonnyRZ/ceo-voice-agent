import { setTimeout as delay } from 'node:timers/promises';
import { expect, type Page } from '@playwright/test';
import { submitLogin } from './session';

// Production's real login budget is shared by all tests on this loopback IP.
// Honor its response instead of disabling the application limit for this smoke test.
async function backoff(headers: Record<string,string>) {
  const seconds=Number(headers['retry-after'] ?? headers['x-retry-after']);
  expect(Number.isFinite(seconds) && seconds>0 && seconds<=10).toBe(true);
  await delay((seconds+0.1)*1000);
}

export async function expectInactive(page: Page,email: string,password: string) {
  let result=await page.request.post('/api/auth/sign-in/email',{data:{email,password}});
  if(result.status()===429) {
    await backoff(result.headers());
    result=await page.request.post('/api/auth/sign-in/email',{data:{email,password}});
  }
  expect(result.status()).toBe(401);
}

export async function loginRecovered(page: Page,email: string,password: string) {
  async function submit() {
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/sign-in/email' && r.request().method()==='POST');
    await submitLogin(page,email,password);
    return response;
  }
  let result=await submit();
  if(result.status()===429) {await backoff(result.headers());result=await submit();}
  expect(result.status()).toBe(200);
}
