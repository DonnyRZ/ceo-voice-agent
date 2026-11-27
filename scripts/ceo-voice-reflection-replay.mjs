import { mock } from 'node:test';
import { createVoiceOutputVerifier } from '../backend/modules/ai/voice/output.ts';
import { matchRawReflection, readReflectionArtifact, saveReflectionWav } from './ceo-voice-reflection-artifact.mjs';

const ackTimeoutMs = 2_000;
const finalDrainMs = 60_000;

async function replay({ events, inputEnds }, control) {
  const gate = createVoiceOutputVerifier();
  const turns = [];
  let delegation;
  let current;
  let active = false;
  let closed = false;
  let time = 0;
  let currentSequence;
  let ordinal = 0;
  let lastDelegationOffset = -1;
  const seenDelegations = new Set();
  const userFragments = new Set();

  function stop(reason) {
    if (current) {
      clearTimeout(current.ackDeadline);
      if (!current.verifying && !current.report.outcome) current.report.outcome = reason;
      current.controller.abort();
      current = undefined;
    }
    gate.reset();
  }

  function begin(event) {
    if (delegation?.id !== event.delegationId) throw new Error('Trace tidak memiliki delegasi untuk pengiriman jawaban.');
    stop('superseded');
    const inputEndMs = inputEnds.get(event.delegationId);
    const turn = { ordinal: ++ordinal, sentSequence: currentSequence, delegationOffsetMs: delegation.offsetMs, inputEndMs };
    const controller = new AbortController();
    const text = control?.ordinal === ordinal && control.kind === 'wrong_text'
      ? `Teks kontrol yang berbeda. ${event.text}` : event.text;
    const capture = gate.begin(text, controller.signal, { notBeforeMs: Math.max(delegation.offsetMs, inputEndMs ?? 0) });
    const record = { report: turn, frames: [], controller, capture, commandId: event.eventId };
    record.ackDeadline = setTimeout(() => {
      if (current === record) stop('ack_timeout');
    }, ackTimeoutMs);
    current = record;
    turns.push(turn);
  }

  function accept(event, sequence) {
    const record = current;
    if (!record || record.commandId !== event.eventId || record.verifying) return;
    record.verifying = true;
    clearTimeout(record.ackDeadline);
    Object.assign(record.report, { acknowledgmentSequence: sequence, acknowledgmentEndMs: event.endMs });
    void record.capture.confirm(event.endMs).then((result) => {
      record.report.diagnostics = result.diagnostics;
      record.report.outcome = result.kind === 'verified' ? result.kind : result.reason;
      if (result.kind === 'verified') {
        Object.assign(record.report, {
          startMs: result.startMs, endMs: result.endMs, pcmBytes: result.pcm.length,
          ...matchRawReflection(record.frames, result),
          completionSequence: currentSequence,
        });
      }
    });
  }

  function outputAudio(frame) {
    if (!active) return;
    current?.frames.push(frame);
    if (control?.kind === 'malformed_pcm' && current?.report.ordinal === control.ordinal &&
        frame.endMs > control.startMs && frame.startMs < control.endMs) {
      gate.appendAudio({ ...frame, pcm: frame.pcm.subarray(0, -1) });
    } else {
      gate.appendAudio(frame);
    }
  }

  function apply({ event, sequence }) {
    switch (event.type) {
      case 'active':
        active = true;
        break;
      case 'standby':
        active = false;
        stop('standby');
        delegation = undefined;
        break;
      case 'closed':
        closed = true;
        active = false;
        stop('closed');
        break;
      case 'journal_revoked':
        if (event.delegationId === delegation?.id) {
          closed = true;
          active = false;
          stop('revoked');
        }
        break;
      case 'delegation':
        if (seenDelegations.has(event.id) || event.offsetMs <= lastDelegationOffset) break;
        seenDelegations.add(event.id);
        lastDelegationOffset = event.offsetMs;
        stop('superseded');
        delegation = event;
        break;
      case 'transcript':
        if (event.fragment.role === 'assistant') {
          if (active) gate.appendTranscript(event.fragment);
        } else if (!userFragments.has(event.fragment.eventId)) {
          userFragments.add(event.fragment.eventId);
          active = true;
          if (current && event.fragment.endMs > delegation?.offsetMs) stop('new_speech');
        }
        break;
      case 'commentary_sent':
        begin(event);
        break;
      case 'commentary_accepted':
        accept(event, sequence);
        break;
      case 'commentary_rejected':
        if (current?.commandId === event.eventId) stop('provider_rejected');
        break;
      case 'output_audio':
        outputAudio(event.frame);
        break;
    }
  }

  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const row of events) {
      const observed = Math.round(row.atMs);
      mock.timers.tick(observed - time);
      time = observed;
      await Promise.resolve();
      currentSequence = row.sequence;
      if (!closed) apply(row);
      await Promise.resolve();
    }
    mock.timers.tick(finalDrainMs);
    await Promise.resolve();
    return turns;
  } finally {
    gate.reset();
    mock.timers.reset();
  }
}

async function verifyControls(artifact, turns) {
  const verified = turns.find(({ outcome, reflectedBytesMatch }) => outcome === 'verified' && reflectedBytesMatch);
  if (!verified) return { exercised: false, reason: 'no_verified_baseline' };
  const checks = [];
  for (const kind of ['wrong_text', 'malformed_pcm']) {
    const result = (await replay(artifact, { ...verified, kind })).find(({ ordinal }) => ordinal === verified.ordinal);
    const expected = kind === 'wrong_text' ? 'mismatch' : 'boundary';
    checks.push({ kind, outcome: result?.outcome, passed: result?.outcome === expected });
  }
  return { exercised: true, turn: verified.ordinal, checks };
}

async function main([tracePath, ...flags]) {
  if (!tracePath || flags.some((flag) => flag !== '--save-wav' && flag !== '--controls')) {
    throw new Error('Pemakaian: node --import tsx scripts/ceo-voice-reflection-replay.mjs TRACE.json [--save-wav] [--controls]');
  }
  const artifact = await readReflectionArtifact(tracePath);
  const turns = await replay(artifact);
  const controls = flags.includes('--controls') ? await verifyControls(artifact, turns) : undefined;
  const safe = turns.every((turn) => turn.outcome !== 'verified' || turn.reflectedBytesMatch && turn.wavSha256);
  if (!safe || controls?.checks?.some(({ passed }) => !passed)) process.exitCode = 1;
  const publicTurns = await Promise.all(turns.map(async ({ wav, ...turn }) => ({
    ...turn,
    replayWav: wav && turn.reflectedBytesMatch && flags.includes('--save-wav')
      ? await saveReflectionWav(tracePath, turn.ordinal, wav) : undefined,
  })));
  console.log(JSON.stringify({
    evidence: 'replayed_provider_events', events: artifact.events.length, safe, turns: publicTurns, controls,
    browserPlaybackMeasured: false, applicationRevocationMarkers: artifact.applicationRevocationMarkers,
  }, null, 2));
}

await main(process.argv.slice(2));
