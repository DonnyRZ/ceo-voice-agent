import { describe, expect, it, vi } from 'vitest';
import { deliverVerifiedAudio, emitVoiceSegment } from './voice-output-fixture.js';
import { answer, harness, owner, type Options } from './voice-service-fixture.js';

describe('CEO Live voice authority', () => {
  it('uses a correction delivered after delegation but within its audio window', async () => {
    vi.useFakeTimers();
    const corrected = 'Status Integrasi Sistem SSO sedang dikerjakan.';
    const stale = 'Status Upgrade Infrastruktur pending.';
    const retrieve = vi.fn<Options['retrieve']>().mockImplementation(async ({ text }) => ({
      ...answer, text: text.includes('Integrasi Sistem SSO') ? corrected : stale,
    }));
    const mock = harness({ settleMs: undefined, retrieve });
    try {
      const { events } = await mock.open();
      mock.userSpeech('prefix', 'Apa status proyek Upgrade Infrastruktur', 0, 850);
      mock.receive({ type: 'delegation', id: 'corrected', offsetMs: 1_600 });
      await vi.advanceTimersByTimeAsync(180);
      mock.userSpeech('suffix', ', bukan itu, melainkan proyek Integrasi Sistem SSO di divisi IT?', 850, 1_550);
      await vi.advanceTimersByTimeAsync(1_020);
      const [eventId] = mock.sendCommentary.mock.calls[0];
      deliverVerifiedAudio(mock.receive, eventId, corrected, 1_850);
      await vi.advanceTimersByTimeAsync(260);
      const result = events.find((event) => event.type === 'result');
      expect(result).toMatchObject({ result: { text: corrected } });
      expect(events).toContainEqual({ type: 'playback', turnId: 'corrected', generation: 1, allowed: true });
    } finally {
      await mock.service.closeAll();
      vi.useRealTimers();
    }
  });

  it('uses late input and complete audio only after the matching ACK, even without an ACK offset', async () => {
    vi.useFakeTimers();
    const mock = harness();
    try {
      const { events } = await mock.open();
      expect(events[0]).toMatchObject({ type: 'state', state: 'standby' });
      mock.receive({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
      mock.userSpeech('fragment-1', 'Tugas', 250, 500);
      mock.userSpeech('fragment-2', ' yang selesai?', 500, 900);
      expect(events).toContainEqual({ type: 'state', state: 'active' });
      await vi.advanceTimersByTimeAsync(560);
      expect(mock.sendCommentary).toHaveBeenCalledOnce();
      expect(mock.retrieve).toHaveBeenCalledWith(expect.objectContaining({ text: 'Tugas yang selesai?' }));
      expect(mock.sendCommentary.mock.calls[0].slice(1)).toEqual(['turn-1', answer.text]);
      const [eventId] = mock.sendCommentary.mock.calls[0];
      emitVoiceSegment(mock.receive, eventId, answer.text);
      mock.receive({ type: 'commentary_accepted', eventId: 'other-command' });
      await vi.advanceTimersByTimeAsync(260);
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'result' }));
      expect(events).not.toContainEqual({ type: 'playback', turnId: 'turn-1', generation: 1, allowed: true });
      mock.receive({ type: 'commentary_accepted', eventId });
      await vi.advanceTimersByTimeAsync(260);
      expect(events.slice(-2)).toEqual([
        { type: 'result', turnId: 'turn-1', generation: 1, result: answer },
        { type: 'playback', turnId: 'turn-1', generation: 1, allowed: true },
      ]);
      mock.receive({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
      expect(mock.retrieve).toHaveBeenCalledOnce();
    } finally {
      await mock.service.closeAll();
      vi.useRealTimers();
    }
  });

  it('drops an already submitted response when newer user speech arrives', async () => {
    const mock = harness();
    const { events } = await mock.open();
    mock.userSpeech('fragment-1', 'Proyek A?', 0, 800);
    mock.receive({ type: 'delegation', id: 'before', offsetMs: 1_000 });
    await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
    mock.userSpeech('fragment-2', 'Maksud saya proyek B.', 1_300, 1_700);
    mock.receive({ type: 'commentary_accepted', eventId: mock.sendCommentary.mock.calls[0][0] });
    mock.receive({ type: 'delegation', id: 'after', offsetMs: 2_000 });
    await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledTimes(2));
    expect(mock.retrieve.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mock.retrieve.mock.calls[1][0]).toMatchObject({ text: 'Maksud saya proyek B.' });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'playback', turnId: 'before', allowed: true }));
    deliverVerifiedAudio(mock.receive, mock.sendCommentary.mock.calls[1][0], answer.text, 2_300);
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'playback', turnId: 'after', generation: 2, allowed: true }));
    await mock.service.closeAll();
  });

  it('rechecks authority after retrieval and closes before sending facts on revocation', async () => {
    const authorize = vi.fn<NonNullable<Options['authorize']>>().mockResolvedValue(true);
    const retrieve = vi.fn<Options['retrieve']>().mockImplementation(async () => {
      authorize.mockResolvedValue(false);
      return answer;
    });
    const mock = harness({ authorize, retrieve });
    const { events } = await mock.open();
    mock.userSpeech('fragment-1', 'Berapa tugas selesai?', 0, 800);
    mock.receive({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'state', state: 'closed', reason: 'revoked' }));
    expect(mock.sendCommentary).not.toHaveBeenCalled();
    expect(mock.adapter.closeSession).toHaveBeenCalledOnce();
    expect(mock.onUsage).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'live_provider', seconds: 16, final: true }));
  });

  it('rechecks access in idle sessions and closes on loss of the sideband', async () => {
    const authorize = vi.fn<NonNullable<Options['authorize']>>().mockResolvedValue(true);
    const mock = harness({ authorize, accessCheckMs: 5 });
    const first = await mock.open();
    authorize.mockResolvedValue(false);
    await vi.waitFor(() => expect(first.events.at(-1)).toEqual({ type: 'state', state: 'closed', reason: 'revoked' }));
    authorize.mockResolvedValue(true);
    const second = await mock.open();
    mock.disconnect();
    expect(second.events.at(-1)).toEqual({ type: 'state', state: 'unavailable', reason: 'unavailable' });
    await mock.service.closeAll();
  });

  it('limits sessions to one per user and binds controls to the original login', async () => {
    const mock = harness();
    const { input, events } = await mock.open();
    await expect(mock.service.start({ ...owner, sessionKey: 'other', sdp: 'offer' })).rejects.toMatchObject({ code: 'session_limit' });
    const wrongOwner = { ...input, sessionKey: 'other' };
    expect(() => mock.service.subscribe(wrongOwner, vi.fn())).toThrowError('session_not_found');
    expect(() => mock.service.stop(wrongOwner)).toThrowError('session_not_found');
    await mock.service.stop(input);
    expect(events.at(-1)).toEqual({ type: 'state', state: 'closed', reason: 'ended' });
    expect(mock.adapter.createSession).toHaveBeenCalledOnce();
  });

  it('loads vocabulary only for the authorized login and passes it to that Live session', async () => {
    const vocabulary = { projects: ['Pintu Utara'], tasks: ['Periksa Panel'] };
    const authorize = vi.fn<NonNullable<Options['authorize']>>().mockImplementation(async ({ sessionKey }) => sessionKey === owner.sessionKey);
    const loadVocabulary = vi.fn<NonNullable<Options['loadVocabulary']>>().mockResolvedValue(vocabulary);
    const mock = harness({ authorize, loadVocabulary });
    try {
      await expect(mock.service.start({ ...owner, sessionKey: 'revoked-login', sdp: 'denied' }))
        .rejects.toMatchObject({ code: 'unauthorized' });
      expect(loadVocabulary).not.toHaveBeenCalled();
      expect(mock.adapter.createSession).not.toHaveBeenCalled();
      await mock.open();
      const signal = loadVocabulary.mock.calls[0][1];
      expect(loadVocabulary).toHaveBeenCalledExactlyOnceWith(owner, signal);
      expect(mock.adapter.createSession).toHaveBeenCalledExactlyOnceWith('offer', signal, vocabulary);
      expect(loadVocabulary.mock.invocationCallOrder[0]).toBeGreaterThan(authorize.mock.invocationCallOrder[1]);
    } finally {
      await mock.service.closeAll();
    }
  });

  it('reports unavailability when retrieval times out and closes if Live rejects the message', async () => {
    const retrieve = vi.fn<Options['retrieve']>().mockImplementation(() => new Promise(() => {}));
    const mock = harness({ retrieve, retrievalTimeoutMs: 15 });
    const { events } = await mock.open();
    mock.userSpeech('fragment-1', 'Tugas yang selesai?', 0, 800);
    mock.receive({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
    await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
    expect(retrieve.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mock.sendCommentary.mock.calls[0].slice(1)).toEqual([
      'turn-1', 'Layanan suara belum bisa memeriksa timesheet. Silakan coba lagi.',
    ]);
    mock.receive({ type: 'commentary_rejected', eventId: mock.sendCommentary.mock.calls[0][0] });
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'state', state: 'unavailable' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'playback', turnId: 'turn-1', allowed: true }));
    await mock.service.closeAll();
  });

  it('keeps audio sealed for incomplete media coverage or a different readout', async () => {
    const retrieve = vi.fn<Options['retrieve']>()
      .mockResolvedValueOnce({ ...answer, context: 'verified by the timesheet' })
      .mockResolvedValue(answer);
    const onMetric = vi.fn<NonNullable<Options['onMetric']>>();
    const mock = harness({ retrieve, onMetric, outputTimeoutMs: 600 });
    const { input, events } = await mock.open();
    try {
      mock.userSpeech('first', 'Status proyek Atlas?', 0, 800);
      mock.receive({ type: 'delegation', id: 'without-timing', offsetMs: 1_000 });
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      const [firstId] = mock.sendCommentary.mock.calls[0];
      mock.receive({ type: 'commentary_accepted', eventId: firstId });
      emitVoiceSegment(mock.receive, firstId, answer.text, 1_600, 400);
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', reason: 'unverified' }));
      await expect(mock.service.takeAudio(input, { turnId: 'without-timing', generation: 1 })).resolves.toBeUndefined();
      expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'output_verify', outcome: 'timeout', missingAckOffset: true,
      }), 'without-timing');

      mock.userSpeech('second', 'Siapa PIC proyek B?', 2_500, 3_100);
      mock.receive({ type: 'delegation', id: 'wrong-fact', offsetMs: 3_300 });
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledTimes(2));
      expect(retrieve.mock.calls[1][0].context).toBe('verified by the timesheet');
      deliverVerifiedAudio(mock.receive, mock.sendCommentary.mock.calls[1][0], 'Tiga tugas selesai.', 3_500);
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', turnId: 'wrong-fact', reason: 'unverified' }));
      await expect(mock.service.takeAudio(input, { turnId: 'wrong-fact', generation: 2 })).resolves.toBeUndefined();
      expect(onMetric).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'output_verify', outcome: 'mismatch',
      }), 'wrong-fact');
    } finally {
      await mock.service.closeAll();
    }
  });

  it('waits for the first wake transcript, gives the current clip once, and clears the last turn after pausing', async () => {
    const mock = harness();
    const { input, events } = await mock.open();
    try {
      mock.receive({ type: 'delegation', id: 'woken', offsetMs: 1_000 });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(mock.retrieve).not.toHaveBeenCalled();
      mock.userSpeech('first', 'Status proyek Atlas?', 0, 800);
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      deliverVerifiedAudio(mock.receive, mock.sendCommentary.mock.calls[0][0], answer.text);
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', allowed: true }));
      await expect(mock.service.takeAudio(input, { turnId: 'woken', generation: 2 })).resolves.toBeUndefined();
      const audio = await mock.service.takeAudio(input, { turnId: 'woken', generation: 1 });
      expect(audio?.subarray(0, 4).toString('ascii')).toBe('RIFF');
      await expect(mock.service.takeAudio(input, { turnId: 'woken', generation: 1 })).resolves.toBeUndefined();
      mock.receive({ type: 'standby' });
      mock.receive({ type: 'delegation', id: 'stale', offsetMs: 3_500 });
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', turnId: 'stale', reason: 'unverified' }));
      expect(mock.retrieve).toHaveBeenCalledOnce();
    } finally {
      await mock.service.closeAll();
    }
  });

  it('prepares candidates without publishing data and discards them when the transcript changes', async () => {
    const prepare = vi.fn<NonNullable<Options['prepare']>>().mockImplementation(async ({ text }) => `candidate: ${text}`);
    const mock = harness({ prepare, prepareDelayMs: 2 });
    const { events } = await mock.open();
    mock.userSpeech('fragment-1', 'Berapa tugas Atlas?', 0, 800);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(mock.retrieve).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'result' }));
    mock.userSpeech('fragment-2', ' Maksud saya Proyek B.', 2_400, 2_800);
    expect(prepare.mock.calls[0][0].signal.aborted).toBe(true);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    mock.receive({ type: 'delegation', id: 'correction', offsetMs: 3_000 });
    await vi.waitFor(() => expect(mock.retrieve).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Maksud saya Proyek B.', prepared: 'candidate: Maksud saya Proyek B.',
    })));
    expect(mock.retrieve).toHaveBeenCalledOnce();
    await mock.service.closeAll();
  });
});
