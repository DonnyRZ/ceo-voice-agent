import { expect, test } from "@playwright/test";
import { mockVoiceApp, openVoice, sessionsPath, startVoice, voicePath } from "./voice-fixture";
import { emitVoice, readTransport } from "./voice-transport";

test("sesi dicabut server menghentikan mikrofon dan membatalkan pemutaran jawaban", async ({ page }) => {
  const server = await mockVoiceApp(page);
  await openVoice(page);
  await startVoice(page);
  await emitVoice(page, { type: "turn", turnId: "turn-revoked", generation: 1 });
  await emitVoice(page, { type: "playback", turnId: "turn-revoked", generation: 1, allowed: true });
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("audio")).toHaveJSProperty("muted", false);
  await emitVoice(page, { type: "state", state: "closed", reason: "revoked" });
  await expect(page.getByRole("alert")).toHaveText("Akses Voice Agent CEO dicabut.");
  await expect(page.getByRole("button", { name: /^Mulai (ngobrol|lagi)$/ })).toBeVisible();
  await expect.poll(async () => (await readTransport(page)).tracks.map(({ readyState }) => readyState)).toEqual(["ended"]);
  expect(await readTransport(page)).toMatchObject({ peers: [{ state: "closed" }], streams: [{ closed: true }] });

  await emitVoice(page, { type: "playback", turnId: "turn-revoked", generation: 1, allowed: true });
  await expect(page.locator("audio")).toHaveJSProperty("muted", true);
  await expect(page.locator("audio")).not.toHaveAttribute("src", /^blob:/);
  expect((await readTransport(page)).audiblePlays).toBe(1);
  expect(server.sessions).toHaveLength(1);
});

test("dua konteks CEO menutup sesi miliknya dan logout melepas media", async ({ page, browser, baseURL }) => {
  const owner = await mockVoiceApp(page);
  await openVoice(page);
  await startVoice(page);

  const otherContext = await browser.newContext({ baseURL, viewport: page.viewportSize() ?? undefined });
  try {
    const other = await otherContext.newPage();
    const separateOwner = await mockVoiceApp(other);
    await openVoice(other);
    await startVoice(other);
    const first = owner.sessions[0];
    const second = separateOwner.sessions[0];
    expect(second).not.toBe(first);
    expect((await readTransport(page)).streams.map(({ url }) => new URL(url).pathname)).toEqual([`${sessionsPath}/${first}/events`]);
    expect((await readTransport(other)).streams.map(({ url }) => new URL(url).pathname)).toEqual([`${sessionsPath}/${second}/events`]);

    await other.getByRole("button", { name: "Akhiri sesi", exact: true }).click();
    await expect.poll(() => separateOwner.closed.slice()).toEqual([second]);
    expect(owner.closed).toEqual([]);
    expect((await readTransport(page)).tracks[0].readyState).toBe("live");

    await page.getByRole("link", { name: "Akun", exact: true }).click();
    await expect.poll(() => owner.closed.slice()).toEqual([first]);
    expect((await readTransport(page)).tracks[0].readyState).toBe("ended");
    await page.getByRole("button", { name: "Keluar", exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
    await page.goto(voicePath);
    await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
    expect(owner.sessions).toEqual([first]);
  } finally {
    await otherContext.close();
  }
});

test("akun Anggota Divisi diarahkan keluar dari halaman CEO", async ({ page }) => {
  const server = await mockVoiceApp(page, { role: "member" });
  await page.goto(voicePath);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { name: "Dashboard Divisi", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mulai (ngobrol|lagi)$/ })).toHaveCount(0);
  expect((await readTransport(page)).microphoneRequests).toBe(0);
  expect(server.requests).toEqual([]);
});
