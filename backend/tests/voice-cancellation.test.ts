import { describe, expect, it, vi } from 'vitest';
import type { LiveSideband, VoiceAdapter } from '../modules/ai/voice/types.js';
import { deliverVerifiedAudio } from './voice-output-fixture.js';
import { answer, harness, owner, type Options } from './voice-service-fixture.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function ask(mock: ReturnType<typeof harness>, id: string, text: string, startMs: number, offsetMs: number) {
  mock.userSpeech(`input-${id}`, text, startMs, offsetMs);
  mock.receive({ type: 'delegation', id, offsetMs });
}

describe('CEO voice cancellation', () => {
  it('holds the per-user slot until a timed-out provider creation is cleaned up', async () => {
    const opening = deferred<Awaited<ReturnType<VoiceAdapter['createSession']>>>();
    const mock = harness({ startupTimeoutMs: 20 });
    mock.adapter.createSession.mockImplementationOnce(() => opening.promise);
    try {
      const failed = expect(mock.service.start({ ...owner, sdp: 'offer' })).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
      await vi.waitFor(() => expect(mock.adapter.createSession).toHaveBeenCalledOnce());
      await failed;
      await expect(mock.service.start({ ...owner, sdp: 'retry' })).rejects.toMatchObject({ code: 'session_limit' });
      expect(mock.adapter.attach).not.toHaveBeenCalled();
      expect(mock.adapter.closeSession).not.toHaveBeenCalled();

      opening.resolve({ id: 'late-create', sdp: 'discarded-answer' });
      await vi.waitFor(() => expect(mock.adapter.closeSession).toHaveBeenCalledExactlyOnceWith(
        'late-create', undefined, expect.any(Function),
      ));
      await mock.open();
      expect(mock.adapter.attach).toHaveBeenCalledOnce();
    } finally {
      opening.resolve({ id: 'late-create', sdp: 'discarded-answer' });
      await mock.service.closeAll();
    }
  });

  it('waits for a late sideband attachment before shutting down its provider session', async () => {
    const opening = deferred<LiveSideband>();
    const sideband = { sendCommentary: vi.fn(), finish: async () => true };
    const mock = harness();
    mock.adapter.attach.mockImplementationOnce(() => opening.promise);
    try {
      const started = mock.service.start({ ...owner, sdp: 'offer' });
      const failed = expect(started).rejects.toMatchObject({ code: 'provider_unavailable' });
      await vi.waitFor(() => expect(mock.adapter.attach).toHaveBeenCalledOnce());
      let closed = false;
      const shuttingDown = mock.service.closeAll().then(() => { closed = true; });
      await failed;
      expect(closed).toBe(false);
      expect(mock.adapter.closeSession).not.toHaveBeenCalled();

      opening.resolve(sideband);
      await shuttingDown;
      expect(mock.adapter.closeSession).toHaveBeenCalledExactlyOnceWith('live_provider', sideband, expect.any(Function));
      expect(sideband.sendCommentary).not.toHaveBeenCalled();
      await expect(mock.service.start({ ...owner, sdp: 'retry' })).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
    } finally {
      opening.resolve(sideband);
      await mock.service.closeAll();
    }
  });

  it.each(['standby', 'disconnect'] as const)('discards a pending delegation timer on %s', async (stop) => {
    vi.useFakeTimers();
    const mock = harness();
    try {
      const { events } = await mock.open();
      ask(mock, 'old', 'Status proyek Atlas?', 0, 1_000);
      expect(events.at(-1)).toMatchObject({ type: 'turn', turnId: 'old' });
      if (stop === 'standby') mock.receive({ type: 'standby' });
      else mock.disconnect();
      await vi.advanceTimersByTimeAsync(1_300);
      expect(mock.retrieve).not.toHaveBeenCalled();
      expect(mock.sendCommentary).not.toHaveBeenCalled();
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'result' }));
    } finally {
      await mock.service.closeAll();
      vi.useRealTimers();
    }
  });

  it.each(['standby', 'disconnect'] as const)('discards retrieval that completes after %s', async (stop) => {
    const pending = deferred<typeof answer>();
    const retrieve = vi.fn<Options['retrieve']>().mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(answer);
    const mock = harness({ retrieve });
    const { events } = await mock.open();
    try {
      ask(mock, 'old', 'Status proyek Atlas?', 0, 1_000);
      await vi.waitFor(() => expect(retrieve).toHaveBeenCalledOnce());
      if (stop === 'standby') mock.receive({ type: 'standby' });
      else mock.disconnect();
      expect(retrieve.mock.calls[0][0].signal.aborted).toBe(true);
      expect(events.at(-1)).toMatchObject({
        type: 'state', state: stop === 'standby' ? 'standby' : 'unavailable',
      });
      pending.resolve(answer);
      const resumed = stop === 'standby' ? events : (await vi.waitFor(mock.open)).events;
      ask(mock, 'fresh', 'Status proyek yang baru?', 3_300, 4_000);
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      const [eventId, turnId] = mock.sendCommentary.mock.calls[0];
      expect(turnId).toBe('fresh');
      deliverVerifiedAudio(mock.receive, eventId, answer.text, 4_500);
      await vi.waitFor(() => expect(resumed.at(-1)).toMatchObject({ type: 'playback', turnId: 'fresh', allowed: true }));
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'result', turnId: 'old' }));
    } finally {
      pending.resolve(answer);
      await mock.service.closeAll();
    }
  });

  it('ignores a pre-pause commentary completion after a newer generation starts', async () => {
    const mock = harness();
    const { input, events } = await mock.open();
    try {
      ask(mock, 'old', 'Status proyek Atlas?', 0, 1_000);
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      const old = mock.sendCommentary.mock.calls[0][0];
      mock.receive({ type: 'standby' });
      mock.receive({ type: 'commentary_accepted', eventId: old, endMs: 1_600 });

      ask(mock, 'fresh', 'Status proyek yang baru?', 3_300, 4_000);
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledTimes(2));
      const fresh = mock.sendCommentary.mock.calls[1][0];
      deliverVerifiedAudio(mock.receive, old, answer.text, 1_600);
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'result' }));
      deliverVerifiedAudio(mock.receive, fresh, answer.text, 4_500);
      await vi.waitFor(() => expect(events.at(-1)).toEqual({
        type: 'playback', turnId: 'fresh', generation: 2, allowed: true,
      }));
      await expect(mock.service.takeAudio(input, { turnId: 'old', generation: 1 })).resolves.toBeUndefined();
      await expect(mock.service.takeAudio(input, { turnId: 'fresh', generation: 2 })).resolves.toBeInstanceOf(Buffer);
    } finally {
      await mock.service.closeAll();
    }
  });

  it('drops an audio download when newer speech arrives during reauthorization', async () => {
    const authorize = vi.fn<NonNullable<Options['authorize']>>().mockResolvedValue(true);
    const delayed = deferred<boolean>();
    const mock = harness({ authorize });
    const { input, events } = await mock.open();
    const key = { turnId: 'old', generation: 1 };
    try {
      ask(mock, key.turnId, 'Status proyek Atlas?', 0, 1_000);
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      deliverVerifiedAudio(mock.receive, mock.sendCommentary.mock.calls[0][0], answer.text);
      await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'playback', ...key, allowed: true }));

      authorize.mockImplementationOnce(() => delayed.promise);
      const checks = authorize.mock.calls.length;
      const download = mock.service.takeAudio(input, key);
      await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(checks + 1));
      mock.userSpeech('interrupt', 'Bukan itu, tugas yang lain.', 3_500, 4_100);
      delayed.resolve(true);
      await expect(download).resolves.toBeUndefined();
      expect(events.at(-1)).toEqual({ type: 'playback', ...key, allowed: false });
      expect(mock.service.recordBrowserPlayback(input, 300, key)).toBe(false);
    } finally {
      delayed.resolve(false);
      await mock.service.closeAll();
    }
  });

  it.each(['verification', 'download'] as const)('invalidates the clip when access is revoked during %s', async (phase) => {
    const authorize = vi.fn<NonNullable<Options['authorize']>>().mockResolvedValue(true);
    const mock = harness({ authorize });
    const { input, events } = await mock.open();
    try {
      ask(mock, 'verified', 'Status proyek Atlas?', 0, 1_000);
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      deliverVerifiedAudio(mock.receive, mock.sendCommentary.mock.calls[0][0], answer.text);
      if (phase === 'download') {
        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', allowed: true }));
        authorize.mockResolvedValue(false);
        await expect(mock.service.takeAudio(input, { turnId: 'verified', generation: 1 })).rejects.toMatchObject({
          code: 'session_not_found',
        });
      } else {
        authorize.mockResolvedValue(false);
        await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'state', state: 'closed', reason: 'revoked' }));
        expect(events).not.toContainEqual(expect.objectContaining({ type: 'playback', allowed: true }));
        expect(events).not.toContainEqual(expect.objectContaining({ type: 'result' }));
      }
      expect(events.at(-1)).toEqual({ type: 'state', state: 'closed', reason: 'revoked' });
    } finally {
      await mock.service.closeAll();
    }
  });
});
