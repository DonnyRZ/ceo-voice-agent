import { expect, test } from "@playwright/test";
import { microphoneButton, mockVoiceApp, openVoice, sessionsPath, startVoice } from "./voice-fixture";
import { emitVoice, readTransport, syntheticAnswer, syntheticOffer } from "./voice-transport";

test("membuka mikrofon dari tombol, mengizinkan suara untuk giliran aktif, lalu menutup sesi", async ({ page }) => {
  const server = await mockVoiceApp(page);
  await openVoice(page);
  await expect(page.getByText("Siap memulai", { exact: true })).toBeVisible();
  expect((await readTransport(page)).microphoneRequests).toBe(0);
  expect(server.requests).toEqual([]);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const reference = page.getByRole("region", { name: "Rujukan Timesheet" });
  await expect(reference).toHaveCount(0);

  await page.getByRole("button", { name: "Mulai sesi", exact: true }).click();
  await expect(page.getByText("Menghubungkan", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readTransport(page)).streams.length).toBe(1);
  expect((await readTransport(page)).tracks[0].enabled).toBe(false);
  await emitVoice(page, { type: "state", state: "active" });
  await expect(page.getByText("Sesi aktif", { exact: true })).toBeVisible();
  const id = server.sessions[0];
  expect(server.requests[0]).toEqual({ method: "POST", path: sessionsPath, data: { sdp: syntheticOffer } });
  const connected = await readTransport(page);
  expect(connected.peers).toEqual([{ state: "connected", answer: syntheticAnswer }]);
  expect(connected.streams.map(({ url }) => new URL(url).pathname)).toEqual([`${sessionsPath}/${id}/events`]);
  expect(connected.tracks).toEqual([{ enabled: true, readyState: "live" }]);

  await microphoneButton(page).click();
  await expect(microphoneButton(page, true)).toBeVisible();
  await expect.poll(async () => (await readTransport(page)).tracks[0].enabled).toBe(false);
  await microphoneButton(page, true).click();
  await expect.poll(async () => (await readTransport(page)).tracks[0].enabled).toBe(true);

  const audio = page.locator("audio");
  await expect(audio).toHaveJSProperty("muted", true);
  await emitVoice(page, { type: "turn", turnId: "turn-denied" });
  await emitVoice(page, { type: "playback", turnId: "turn-denied", allowed: false });
  await emitVoice(page, { type: "turn", turnId: "turn-current" });
  await emitVoice(page, { type: "playback", turnId: "turn-denied", allowed: true });
  await expect(audio).toHaveJSProperty("muted", true);
  expect((await readTransport(page)).audiblePlays).toBe(0);

  await emitVoice(page, {
    type: "result", turnId: "turn-current", result: {
      kind: "facts", text: "Aplikasi A Mobile sedang dikerjakan.", facts: {
        intent: "status", entity: { kind: "project", id: "demo-project", name: "Aplikasi A Mobile", divisionName: "IT" },
        status: "on_progress", updatedAt: "2026-11-26T02:15:00Z",
      },
    },
  });
  await expect(reference.getByText("Aplikasi A Mobile", { exact: true })).toBeVisible();
  await expect(reference.getByText("On Progress", { exact: true })).toBeVisible();
  await expect(audio).toHaveJSProperty("muted", true);
  await emitVoice(page, { type: "playback", turnId: "turn-current", allowed: true });
  await expect(audio).toHaveJSProperty("muted", false);
  await expect(page.getByText(/^Giliran ke pemutaran browser \d+ ms$/)).toBeVisible();
  await expect.poll(() => server.requests.some((request) =>
    request.method === "POST" && request.path.endsWith("/telemetry"))).toBe(true);
  expect((await readTransport(page)).audiblePlays).toBe(1);

  await emitVoice(page, { type: "turn", turnId: "turn-next" });
  await emitVoice(page, { type: "playback", turnId: "turn-current", allowed: true });
  await expect(audio).toHaveJSProperty("muted", true);
  await expect(reference).toHaveCount(0);
  await emitVoice(page, { type: "state", state: "standby" });
  await expect(page.getByText("Siaga", { exact: true })).toBeVisible();
  expect((await readTransport(page)).tracks[0].readyState).toBe("live");

  await page.getByRole("button", { name: "Akhiri sesi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mulai sesi", exact: true })).toBeVisible();
  await expect.poll(() => server.closed.slice()).toEqual([id]);
  const ended = await readTransport(page);
  expect(ended.tracks[0].readyState).toBe("ended");
  expect(ended.streams[0].closed).toBe(true);
  expect(ended.peers[0].state).toBe("closed");
  expect(server.providerRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("izin mikrofon ditolak dan percobaan ulang dimulai dari tombol", async ({ page }) => {
  const server = await mockVoiceApp(page, { denyMicrophone: true });
  await openVoice(page);
  const start = page.getByRole("button", { name: "Mulai sesi", exact: true });
  await start.click();
  await expect(page.getByText("Izin mikrofon ditolak.", { exact: true })).toBeVisible();
  expect(server.requests).toEqual([]);
  expect(await readTransport(page)).toMatchObject({ microphoneRequests: 1, tracks: [], peers: [], streams: [] });

  await page.evaluate(() => window.rkVoiceTest.allowMicrophone());
  await startVoice(page);
  expect((await readTransport(page)).microphoneRequests).toBe(2);
  expect(server.sessions).toHaveLength(1);
  await page.getByRole("button", { name: "Akhiri sesi", exact: true }).click();
  await expect.poll(() => server.closed.slice()).toEqual(server.sessions);
});

test("koneksi putus menutup media dan percobaan ulang mengabaikan event sesi sebelumnya", async ({ page }) => {
  const server = await mockVoiceApp(page);
  await openVoice(page);
  await startVoice(page);
  await page.evaluate(() => window.rkVoiceTest.disconnect());
  await expect(page.getByRole("alert")).toHaveText("Sesi suara terputus. Coba mulai lagi.");
  await expect(page.getByRole("button", { name: "Mulai sesi", exact: true })).toBeVisible();
  await expect.poll(() => server.closed.slice()).toEqual([server.sessions[0]]);
  expect(await readTransport(page)).toMatchObject({
    tracks: [{ readyState: "ended" }], peers: [{ state: "closed" }], streams: [{ closed: true }],
  });

  await startVoice(page, 2);
  expect(new Set(server.sessions).size).toBe(2);
  await emitVoice(page, { type: "state", state: "closed", reason: "revoked" }, 0);
  await expect(page.getByRole("button", { name: "Akhiri sesi", exact: true })).toBeVisible();
  const current = await readTransport(page);
  expect(current.peers[1].state).toBe("connected");
  expect(current.tracks[1].readyState).toBe("live");

  await page.getByRole("button", { name: "Akhiri sesi", exact: true }).click();
  await expect.poll(() => server.closed.slice()).toEqual(server.sessions);
});

test("penolakan server menutup mikrofon tanpa membuka aliran event", async ({ page }) => {
  const server = await mockVoiceApp(page, { startStatus: 503 });
  await openVoice(page);
  const start = page.getByRole("button", { name: "Mulai sesi", exact: true });
  await start.click();
  await expect.poll(async () => (await readTransport(page)).tracks.map(({ readyState }) => readyState)).toEqual(["ended"]);
  await expect(start).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Voice Agent belum tersedia.");
  expect((await readTransport(page)).streams).toEqual([]);
  expect(server.requests.map(({ method }) => method)).toEqual(["POST"]);
  expect(server.providerRequests).toEqual([]);
});
