import type { VoiceCloseReason } from './types.js';

export class VoiceServiceError extends Error {
  constructor(readonly code: 'unauthorized' | 'provider_unavailable' | 'session_not_found' | 'session_limit') {
    super(code);
  }
}

export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export const voiceTerminalState = (reason: VoiceCloseReason) => reason === 'unavailable' ? 'unavailable' : 'closed';
