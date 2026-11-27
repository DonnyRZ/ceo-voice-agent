import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureVoiceSampleRate, mockVoiceApp, openVoice, startVoice, verifiedWav } from "./voice-fixture";
import { emitVoice, readTransport } from "./voice-transport";

const frequencies = [440, 660, 880];

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    ignoreDefaultArgs: ["--mute-audio"],
    args: ["--auto-accept-this-tab-capture"],
  },
});

function toneWave(tones = frequencies, segmentMs = 320) {
  const sampleRate = fixtureVoiceSampleRate;
  const segmentFrames = sampleRate * segmentMs / 1000;
  const frameCount = segmentFrames * tones.length;
  const pcm = Buffer.alloc(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame++) {
    const frequency = tones[Math.floor(frame / segmentFrames)];
    pcm.writeInt16LE(Math.round(12_000 * Math.sin(2 * Math.PI * frame * frequency / sampleRate)), 2 * frame);
  }
  return verifiedWav(pcm);
}

type CapturableAudio = HTMLAudioElement & { captureStream(): MediaStream };

async function monitorAudio(page: Page, tones = frequencies) {
  const captureTab = process.env.E2E_CEO_AUDIO_TAB === "true";
  return page.evaluate(async ({ frequencies, captureTab }) => {
    const player = document.querySelector<CapturableAudio>("audio");
    if (!player) throw new Error("Audio player unavailable");
    const context = new AudioContext();
    const stream = captureTab
      ? await navigator.mediaDevices.getDisplayMedia({
        video: true, audio: { suppressLocalAudioPlayback: false }, preferCurrentTab: true,
        selfBrowserSurface: "include", systemAudio: "exclude", monitorTypeSurfaces: "exclude",
      } as DisplayMediaStreamOptions)
      : player.captureStream();
    if (captureTab && stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser") {
      throw new Error("Expected tab capture");
    }
    await context.resume();
    const analyzer = context.createAnalyser();
    analyzer.fftSize = 2048;
    const samples = new Float32Array(analyzer.fftSize);
    const output: number[] = [];
    player.addEventListener("loadedmetadata", () => Object.assign(player, { testDuration: player.duration }), { once: true });
    player.addEventListener("ended", () => Object.assign(player, { testEnded: true }), { once: true });
    const listener = () => {
      if (stream.getAudioTracks().length) context.createMediaStreamSource(stream).connect(analyzer);
    };
    if (stream.getAudioTracks().length) listener();
    else stream.addEventListener("addtrack", listener, { once: true });
    const timer = window.setInterval(() => {
      analyzer.getFloatTimeDomainData(samples);
      const power = samples.reduce((sum, sample) => sum + sample ** 2, 0);
      if (power / samples.length < 0.008) return;
      for (const frequency of frequencies) {
        let cosine = 0;
        let sine = 0;
        for (let index = 0; index < samples.length; index++) {
          const phase = 2 * Math.PI * index * frequency / context.sampleRate;
          cosine += samples[index] * Math.cos(phase);
          sine += samples[index] * Math.sin(phase);
        }
        if (2 * (cosine ** 2 + sine ** 2) / (power * samples.length) > 0.8 && output.at(-1) !== frequency) {
          output.push(frequency);
        }
      }
    }, 12);
    Object.assign(player, { testCaptures: output, finishTestCapture: async () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
    } });
  }, { frequencies: tones, captureTab });
}

function finishCapture(player: Locator) {
  return player.evaluate((element: HTMLAudioElement & { finishTestCapture(): Promise<void> }) => element.finishTestCapture());
}

test("audio terverifikasi dibaca browser dari awal sampai akhir", async ({ page }) => {
  const server = await mockVoiceApp(page, { nativePlaybackWav: toneWave() });
  await openVoice(page);
  await startVoice(page);
  await monitorAudio(page);
  const player = page.locator("audio");
  const turn = { turnId: "native-audio", generation: 1 };
  try {
    await emitVoice(page, { type: "turn", ...turn });
    await expect(player).toHaveJSProperty("muted", true);
    expect(server.requests.filter(({ path }) => path.endsWith("/audio"))).toHaveLength(0);
    await emitVoice(page, { type: "playback", ...turn, allowed: true });
    await expect(player).toHaveJSProperty("testEnded", true);
    await expect(player).toHaveJSProperty("testCaptures", frequencies);
    expect((await readTransport(page)).remoteTrackEnabled).toEqual([false]);
    expect(server.providerRequests).toEqual([]);
    await expect.poll(() => server.requests.filter(({ path }) => path.endsWith("/telemetry")).map(({ data }) => data))
      .toEqual([{ ...turn, elapsedMs: expect.any(Number) }]);
  } finally {
    await finishCapture(player);
  }
});

test("jawaban terverifikasi sembilan detik diputar sampai akhir", async ({ page }) => {
  const tones = [420, 520, 620, 720, 820, 920];
  await mockVoiceApp(page, { nativePlaybackWav: toneWave(tones, 1500) });
  await openVoice(page);
  await startVoice(page);
  await monitorAudio(page, tones);
  const player = page.locator("audio");
  const turn = { turnId: "native-long-audio", generation: 1 };
  try {
    await emitVoice(page, { type: "turn", ...turn });
    await emitVoice(page, { type: "playback", ...turn, allowed: true });
    await expect(player).toHaveJSProperty("testDuration", 9);
    await expect(player).toHaveJSProperty("testEnded", true, { timeout: 15_000 });
    await expect(player).toHaveJSProperty("testCaptures", tones);
  } finally {
    await finishCapture(player);
  }
});

test("interupsi saat jawaban diputar menghentikan audio sebelum bagian berikutnya", async ({ page }) => {
  const tones = [520, 740, 960];
  const segmentMs = 800;
  const server = await mockVoiceApp(page, { nativePlaybackWav: toneWave(tones, segmentMs) });
  await openVoice(page);
  await startVoice(page);
  await monitorAudio(page, tones);
  const player = page.locator("audio");
  const turn = { turnId: "native-interrupted", generation: 1 };
  const grant = { type: "playback", ...turn, allowed: true };
  try {
    await emitVoice(page, { type: "turn", ...turn });
    await emitVoice(page, grant);
    await expect(player).toHaveJSProperty("testCaptures", [tones[0]]);
    await expect(player).toHaveJSProperty("paused", false);
    await page.evaluate(() => window.rkVoiceTest.localSpeech());
    await expect(player).toHaveJSProperty("paused", true);
    await expect(player).toHaveJSProperty("muted", true);
    await emitVoice(page, grant);

    // Keep the monitor running for the full clip duration to detect queued stale audio.
    await page.evaluate((duration) => new Promise((resolve) => setTimeout(resolve, duration)), segmentMs * tones.length);
    await expect(player).toHaveJSProperty("testCaptures", [tones[0]]);
    expect(await player.evaluate((element: HTMLAudioElement & { testEnded?: boolean }) => element.testEnded)).toBeUndefined();
    expect(server.requests.filter(({ path }) => path.endsWith("/audio"))).toHaveLength(1);
  } finally {
    await finishCapture(player);
  }
});
