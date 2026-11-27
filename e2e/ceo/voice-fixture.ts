import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { emitVoice, installVoiceTransport, readTransport, syntheticAnswer } from "./voice-transport";

export const voicePath = "/ceo/voice";
export const sessionsPath = "/api/ceo/voice/sessions";

type Role = "ceo" | "superadmin" | "member";
type VoiceRequest = { method: string; path: string; data?: unknown };

interface VoiceFixtureOptions {
  role?: Role | null;
  denyMicrophone?: boolean;
  startStatus?: number;
}

export async function mockVoiceApp(page: Page, options: VoiceFixtureOptions = {}) {
  const role = options.role === undefined ? "ceo" : options.role;
  let signedIn = role !== null;
  const requests: VoiceRequest[] = [];
  const sessions: string[] = [];
  const closed: string[] = [];
  const providerRequests: string[] = [];
  const identity = {
    id: randomUUID(), name: "Pengguna Uji Voice", email: "voice-ui@ruangkerja.test", role,
    divisionId: role === "member" ? randomUUID() : null,
    divisionName: role === "member" ? "IT" : null,
  };

  await installVoiceTransport(page, options.denyMicrophone);
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
    const path = new URL(request.url()).pathname;
    const data = request.postData() === null ? undefined : request.postDataJSON();
    requests.push({ method, path, data });
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

    const [id, action] = path.slice(sessionsPath.length + 1).split('/');
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
  return { requests, sessions, closed, providerRequests };
}

export async function openVoice(page: Page) {
  await page.goto(voicePath);
  await expect(page.getByRole("heading", { name: "Uji Voice Agent CEO", exact: true })).toBeVisible();
}

export async function startVoice(page: Page, expectedSessions = 1) {
  await page.getByRole("button", { name: "Mulai sesi", exact: true }).click();
  await expect.poll(async () => (await readTransport(page)).streams.length).toBe(expectedSessions);
  await emitVoice(page, { type: "state", state: "active" });
  await expect(page.getByText("Sesi aktif", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Akhiri sesi", exact: true })).toBeVisible();
}

export function microphoneButton(page: Page, muted = false) {
  return page.getByRole("button", { name: muted ? "Aktifkan mikrofon" : "Bisukan mikrofon", exact: true });
}
