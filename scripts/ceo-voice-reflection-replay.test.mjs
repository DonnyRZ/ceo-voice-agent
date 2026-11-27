import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const replay = fileURLToPath(new URL('./ceo-voice-reflection-replay.mjs', import.meta.url));
const answer = 'Pengerjaan sudah selesai.';

function syntheticTrace() {
  const pieces = [];
  const events = [];
  let pcmBytes = 0;
  function record(event) { events.push({ sequence: events.length + 1, atMs: events.length * 100, event }); }
  function frame(startMs, endMs, sample = 0) {
    const length = (endMs - startMs) * 48;
    const pcm = Buffer.alloc(length);
    for (let offset = 0; offset < length; offset += 2) pcm.writeInt16LE(sample, offset);
    pieces.push(pcm);
    record({ type: 'output_audio', frame: { startMs, endMs, pcmOffset: pcmBytes, pcmLength: length } });
    pcmBytes += length;
  }
  record({ type: 'active' });
  record({ type: 'delegation', id: 'synthetic-turn', offsetMs: 1_000 });
  frame(800, 1_000);
  record({ type: 'commentary_sent', eventId: 'synthetic-command', delegationId: 'synthetic-turn', text: answer });
  record({ type: 'commentary_accepted', eventId: 'synthetic-command', endMs: 1_200 });
  frame(1_000, 1_200);
  frame(1_200, 1_500, 800);
  record({ type: 'transcript', fragment: { eventId: 'synthetic-transcript', role: 'assistant', startMs: 1_200, endMs: 1_500, text: answer } });
  frame(1_500, 2_300);
  frame(2_300, 2_900);
  const pcm = Buffer.concat(pieces);
  const artifact = { version: 1, representation: 'parsed-live-events', sampleRate: 24_000, channels: 1, format: 's16le',
    pcm: 'fixture-reflection.pcm', pcmBytes, sha256: createHash('sha256').update(pcm).digest('hex'), truncated: false, events };
  return { artifact, pcm };
}

test('replays exact reflected PCM bytes and withholds both negative controls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-reflection-'));
  const metadata = join(directory, 'fixture-reflection.json');
  const { artifact, pcm } = syntheticTrace();
  async function invoke() {
    const { stdout } = await run(process.execPath, ['--import', 'tsx', replay, metadata, '--controls']);
    return JSON.parse(stdout);
  }
  try {
    await writeFile(metadata, JSON.stringify(artifact));
    const pcmFile = join(directory, artifact.pcm);
    await writeFile(pcmFile, pcm);
    const report = await invoke();
    assert.equal(report.browserPlaybackMeasured, false);
    assert.equal(report.turns.length, 1);
    assert.equal(report.turns[0].outcome, 'verified');
    assert.equal(report.turns[0].reflectedBytesMatch, true);
    assert.deepEqual(report.controls.checks.map(({ outcome }) => outcome), ['mismatch', 'boundary']);

    artifact.journal = { inputEnds: [{ delegationId: 'synthetic-turn', endMs: 1_000 }],
      stops: [{ delegationId: 'synthetic-turn', atMs: 750 }] };
    await writeFile(metadata, JSON.stringify(artifact));
    const revoked = await invoke();
    assert.equal(revoked.applicationRevocationMarkers, 1);
    assert.equal(revoked.turns[0].outcome, 'aborted');
    assert.equal(revoked.turns[0].wavSha256, undefined);

    const damaged = await readFile(pcmFile);
    damaged[0] ^= 1;
    await writeFile(pcmFile, damaged);
    await assert.rejects(invoke(), /SHA-256 PCM tidak cocok/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
