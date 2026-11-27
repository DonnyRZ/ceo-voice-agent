import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { emitVoice, installVoiceTransport, readTransport, syntheticAnswer } from "./voice-transport";

export const voicePath = "/ceo/voice";
export const sessionsPath = "/api/ceo/voice/sessions";
export const fixtureVoiceSampleRate = 24_000;

type Role = "ceo" | "superadmin" | "member";
type VoiceRequest = { method: string; path: string; data?: unknown; generation?: string };

interface VoiceFixtureOptions {
  role?: Role | null;
  denyMicrophone?: boolean;
  startStatus?: number;
  holdAudio?: boolean;
  invalidAudio?: boolean;
  nativePlaybackWav?: Buffer;
}

export function verifiedWav(pcm = Buffer.alloc(960)) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(fixtureVoiceSampleRate, 24);
  wav.writeUInt32LE(fixtureVoiceSampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

export async function mockVoiceApp(page: Page, options: VoiceFixtureOptions = {}) {
  const role = options.role === undefined ? "ceo" : options.role;
  let signedIn = role !== null;
  const requests: VoiceRequest[] = [];
  const sessions: string[] = [];
  const closed: string[] = [];
  const providerRequests: string[] = [];
  let releaseAudio: () => void = () => {};
  const audioGate = options.holdAudio ? new Promise<void>((resolve) => { releaseAudio = resolve; }) : Promise.resolve();
  const identity = {
    id: randomUUID(), name: "Pengguna Uji Voice", email: "voice-ui@ruangkerja.test", role,
    divisionId: role === "member" ? randomUUID() : null,
    divisionName: role === "member" ? "IT" : null,
  };

  await installVoiceTransport(page, options.denyMicrophone, Boolean(options.nativePlaybackWav));
  await page.route((url) => url.hostname === "openai.com" || url.hostname.endsWith(".openai.com"), async (route) => {
    providerRequests.push(new URL(route.request().url()).hostname);
    await route.abort();
  });
  await page.route("**/api/session", async (route) => {
    await route.fulfill(signedIn ? { json: { user: identity } } : { status: 401, json: { message: "Sesi berakhir." } });
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    signedIn = false;
    await route.fulfill({ json: { success: true } });
  });
  if (role === "member") {
    await page.route((url) => ["/api/tasks", "/api/projects"].includes(url.pathname), async (route) => {
      await route.fulfill({ json: [] });
    });
  }
  await page.route((url) => url.pathname.startsWith("/api/ceo/voice/"), async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const data = request.postData() === null ? undefined : request.postDataJSON();
    const generation = url.searchParams.get("generation");
    requests.push({ method, path, data, ...(generation ? { generation } : {}) });
    if (method === "POST" && path === sessionsPath) {
      if (options.startStatus) {
        await route.fulfill({ status: options.startStatus, json: { message: "Sesi suara belum tersedia." } });
      } else {
        const id = randomUUID();
        sessions.push(id);
        await route.fulfill({ status: 201, json: { id, sdp: syntheticAnswer } });
      }
      return;
    }

    const [id, action, , suffix] = path.slice(sessionsPath.length + 1).split('/');
    if (method === "GET" && action === "turns" && suffix === "audio" && sessions.includes(id)) {
      await audioGate;
      await route.fulfill({ status: 200, contentType: "audio/wav",
        headers: { "cache-control": "no-store" },
        body: options.invalidAudio ? Buffer.from("unverified") : options.nativePlaybackWav ?? verifiedWav(),
      }).catch(() => {});
      return;
    }
    if (method === "POST" && action === "telemetry" && sessions.includes(id)) {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "DELETE" && sessions.includes(id)) {
      closed.push(id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Sesi suara tidak ditemukan." } });
  });
  return { requests, sessions, closed, providerRequests, releaseAudio };
}

export async function openVoice(page: Page) {
  await page.goto(voicePath);
  await expect(page.getByRole("heading", { name: "Voice Agent", exact: true })).toBeVisible();
}

export async function startVoice(page: Page, expectedSessions = 1) {
  await page.getByRole("button", { name: /^Mulai (ngobrol|lagi)$/ }).click();
  await expect.poll(async () => (await readTransport(page)).streams.length).toBe(expectedSessions);
  await emitVoice(page, { type: "state", state: "active" });
  await expect(page.getByText("Mendengarkan", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Akhiri sesi", exact: true })).toBeVisible();
}

export function microphoneButton(page: Page, muted = false) {
  return page.getByRole("button", { name: muted ? "Aktifkan mikrofon" : "Bisukan mikrofon", exact: true });
}
