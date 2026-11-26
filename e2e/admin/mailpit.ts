import { expect } from "@playwright/test";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function requireLocalSmtp() {
  const host = process.env.SMTP_HOST ?? "127.0.0.1";
  if (!loopback.has(host)) throw new Error("Use a local SMTP test server for browser invitations.");
}

async function readMailpit<T>(path: string): Promise<T> {
  const base = new URL(process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025");
  if (!loopback.has(base.hostname)) throw new Error("Playwright requires a local test mailbox.");
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Mailpit API returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function invitationLink(email: string) {
  if (!email.endsWith(".test")) throw new Error("Use a fake .test recipient for invitation tests.");
  const search = new URLSearchParams({ query: `to:${email}` });
  let messageId: string | undefined;
  await expect.poll(async () => {
    const result = await readMailpit<{ messages: { ID: string }[] | null }>(`/api/v1/search?${search}`);
    messageId = result.messages?.[0]?.ID;
    return Boolean(messageId);
  }, { timeout: 12_000 }).toBe(true);

  const { Text } = await readMailpit<{ Text: string }>(`/api/v1/message/${messageId}`);
  const links = (Text.match(/https?:\/\/[^\s<>]+/gu) ?? []).map((link) => new URL(link));
  const activation = links.find((url) => url.pathname === "/activate" && new URLSearchParams(url.hash.slice(1)).has("token"));
  if (!activation || !loopback.has(activation.hostname)) {
    throw new Error("Mailpit did not receive a local activation link.");
  }
  return activation.href;
}
