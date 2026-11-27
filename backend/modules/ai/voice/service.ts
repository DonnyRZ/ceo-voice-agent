import { VoiceServiceError } from './lifecycle.js';
import { VoiceSession } from './session.js';
import type { OwnedVoiceSession, VoiceEvent, VoiceOwner, VoiceServiceOptions, VoiceTurnKey } from './types.js';

export { VoiceServiceError } from './lifecycle.js';
export type { VoiceAdapter, VoiceEvent, VoiceMetric, VoiceServiceOptions } from './types.js';

export function createVoiceService<Context, Facts, Prepared = unknown>(options: VoiceServiceOptions<Context, Facts, Prepared>) {
  const sessions = new Map<string, VoiceSession<Context, Facts, Prepared>>();
  const activeUsers = new Set<string>();
  const closing = new Set<Promise<void>>();
  let stopped = false;

  function onEnd(session: VoiceSession<Context, Facts, Prepared>, cleanup: Promise<void>) {
    sessions.delete(session.id);
    closing.add(cleanup);
    void cleanup.finally(() => {
      closing.delete(cleanup);
      activeUsers.delete(session.owner.userId);
    });
  }

  function ownedSession({ id, userId, sessionKey }: OwnedVoiceSession) {
    const session = sessions.get(id);
    if (!session || session.owner.userId !== userId || session.owner.sessionKey !== sessionKey) {
      throw new VoiceServiceError('session_not_found');
    }
    return session;
  }

  return {
    async start({ userId, sessionKey, sdp }: VoiceOwner & { sdp: string }) {
      if (stopped) throw new VoiceServiceError('provider_unavailable');
      if (activeUsers.has(userId) || activeUsers.size >= (options.maxSessions ?? 16)) {
        throw new VoiceServiceError('session_limit');
      }
      const session = new VoiceSession({ userId, sessionKey }, options, onEnd);
      sessions.set(session.id, session);
      activeUsers.add(userId);
      return session.start(sdp);
    },

    subscribe(input: OwnedVoiceSession, listener: (event: VoiceEvent<Facts>) => void) {
      return ownedSession(input).subscribe(listener);
    },

    stop(input: OwnedVoiceSession) {
      return ownedSession(input).end('ended');
    },

    takeAudio(input: OwnedVoiceSession, turn: VoiceTurnKey) {
      return ownedSession(input).takeAudio(turn);
    },

    recordBrowserPlayback(input: OwnedVoiceSession, elapsedMs: number, turn?: VoiceTurnKey) {
      return ownedSession(input).recordBrowserPlayback(elapsedMs, turn);
    },

    async closeAll() {
      stopped = true;
      for (const session of sessions.values()) void session.end('ended');
      await Promise.all(closing);
    },
  };
}
