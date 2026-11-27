import type { LiveEvent } from './types.js';
import { decodeReflectedPcm } from './output-audio.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readUsage(event: Record<string, unknown>) {
  return isRecord(event.usage) && validOffset(event.usage.seconds) ? event.usage.seconds : undefined;
}

export function parseLiveEvent(message: string): LiveEvent | undefined {
  let event: unknown;
  try {
    event = JSON.parse(message);
  } catch {
    return;
  }
  if (!isRecord(event)) return;

  switch (event.type) {
    case 'session.paused':
      return { type: 'standby' };
    case 'session.resumed':
      return { type: 'active' };
    case 'session.closed': {
      const reason = event.reason === 'expired' ? 'timeout'
        : event.reason === 'connection_lost' || event.reason === 'content' ? 'unavailable' : 'ended';
      return { type: 'closed', seconds: readUsage(event), reason };
    }
    case 'session.usage.updated': {
      const seconds = readUsage(event);
      if (seconds !== undefined) return { type: 'usage', seconds };
      return;
    }
    case 'session.input_transcript.delta':
    case 'session.output_transcript.delta': {
      const { event_id: eventId, delta: text, start_ms: startMs, end_ms: endMs } = event;
      if (typeof eventId === 'string' && typeof text === 'string' && validOffset(startMs) && validOffset(endMs)) {
        const role = event.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
        return { type: 'transcript', fragment: { eventId, role, text, startMs, endMs } };
      }
      return;
    }
    case 'session.output_audio.delta': {
      const { delta, start_ms: startMs, end_ms: endMs } = event;
      if (!validOffset(startMs) || !validOffset(endMs)) return;
      const pcm = decodeReflectedPcm(delta, startMs, endMs);
      if (pcm) return { type: 'output_audio', frame: { pcm, startMs, endMs } };
      return;
    }
    case 'session.delegation.created': {
      const { delegation, offset_ms: offsetMs } = event;
      if (isRecord(delegation) && delegation.target === 'client' && typeof delegation.id === 'string' && validOffset(offsetMs)) {
        return { type: 'delegation', id: delegation.id, offsetMs };
      }
      return;
    }
    case 'session.commentary.appended':
      if (typeof event.client_event_id === 'string') {
        const accepted = { type: 'commentary_accepted' as const, eventId: event.client_event_id };
        return validOffset(event.end_ms) ? { ...accepted, endMs: event.end_ms } : accepted;
      }
      return;
    case 'error': {
      const error = isRecord(event.error) ? event.error : event;
      if (typeof error.client_event_id === 'string') {
        return { type: 'commentary_rejected', eventId: error.client_event_id };
      }
      const code = typeof error.code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'unknown';
      return { type: 'provider_error', code };
    }
  }
}
