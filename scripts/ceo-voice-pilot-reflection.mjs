import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const audioLimit = 4 * 1024 * 1024;
const metadataLimit = 1024 * 1024;
const eventLimit = 12_000;

export function assertSyntheticReflectionInputs(manifest, trials) {
  for (const trial of trials) {
    const setup = trial.setup?.length ? trial.setup : trial.mode === 'new' ? [] : [manifest.smoke?.[0]];
    const clips = [trial.speech, ...setup.map((turn) => turn?.speech), ...(trial.action?.speech ? [trial.action.speech] : [])];
    if (clips.some((clip) => clip?.source !== 'synthetic-espeak' || !/^[a-f0-9]{64}$/.test(clip.sha256))) {
      throw new Error('Trace PCM hanya tersedia untuk fixture sintetis ber-hash.');
    }
  }
}

export function createPilotReflectionTrace() {
  const first = performance.now();
  const startedAt = Date.now();
  const frames = [];
  const events = [];
  let pcmBytes = 0;
  let metadataBytes = 0;
  let truncated = false;

  function record(event, pcm) {
    if (truncated) return;
    const next = { sequence: events.length + 1, atMs: Number((performance.now() - first).toFixed(3)), event };
    const size = Buffer.byteLength(JSON.stringify(next));
    if (events.length >= eventLimit || metadataBytes + size > metadataLimit ||
        pcmBytes + (pcm?.length ?? 0) > audioLimit) {
      truncated = true;
      return;
    }
    if (pcm) {
      frames.push(Buffer.from(pcm));
      pcmBytes += pcm.length;
    }
    events.push(next);
    metadataBytes += size;
  }

  return {
    providerEvent(event) {
      switch (event.type) {
        case 'output_audio': {
          const { startMs, endMs, pcm } = event.frame;
          record({ type: event.type, frame: { startMs, endMs, pcmOffset: pcmBytes, pcmLength: pcm.length } }, pcm);
          break;
        }
        case 'transcript':
          record({ type: event.type, fragment: { ...event.fragment } });
          break;
        case 'commentary_accepted':
          record({ type: event.type, eventId: event.eventId, endMs: event.endMs });
          break;
        case 'commentary_rejected':
          record({ type: event.type, eventId: event.eventId });
          break;
        case 'delegation':
          record({ type: event.type, id: event.id, offsetMs: event.offsetMs });
          break;
        case 'active':
        case 'standby':
        case 'closed':
          record({ type: event.type });
          break;
      }
    },

    commentarySent(eventId, delegationId, text) {
      record({ type: 'commentary_sent', eventId, delegationId, text });
    },

    async save(directory, id, journal) {
      if (!/^[a-z0-9-]{1,113}$/.test(id)) throw new Error('ID trace PCM tidak valid.');
      const file = id + '-reflection.json';
      const pcm = id + '-reflection.pcm';
      const binary = Buffer.concat(frames, pcmBytes);
      const sha256 = createHash('sha256').update(binary).digest('hex');
      const summary = { file, pcm, pcmBytes, sha256, events: events.length, truncated };
      await writeFile(join(directory, pcm), binary, { mode: 0o600, flag: 'wx' });
      await writeFile(join(directory, file), JSON.stringify({
        version: 1, representation: 'parsed-live-events', sampleRate: 24_000, channels: 1, format: 's16le',
        pcm, pcmBytes, sha256, truncated, events, journal: replayMarkers(journal, startedAt),
      }) + '\n', { mode: 0o600, flag: 'wx' });
      return summary;
    },
  };
}

function replayMarkers(journal, startedAt) {
  if (!journal) return;
  const inputEnds = [];
  const stops = [];
  for (const { entry, recordedAt } of journal.events) {
    if (entry.type === 'turn_input') inputEnds.push({ delegationId: entry.turnId, endMs: entry.userEndMs });
    if (entry.type === 'playback_stopped' && entry.reason === 'revoked') {
      stops.push({ delegationId: entry.turnId, atMs: new Date(recordedAt).getTime() - startedAt });
    }
  }
  return { inputEnds, stops, hasSequenceGaps: journal.hasSequenceGaps };
}
