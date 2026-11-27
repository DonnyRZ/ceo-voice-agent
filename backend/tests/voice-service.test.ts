import { describe, expect, it, vi } from 'vitest';
import { createVoiceService } from '../modules/ai/voice/service.js';
import type { LiveEvent, LiveHandlers, VoiceAdapter, VoiceEvent, VoiceServiceOptions } from '../modules/ai/voice/types.js';

const owner = { userId: 'ceo', sessionKey: 'login-1' };
const answer = { kind: 'facts' as const, text: 'Dua tugas selesai.', facts: { count: 2 } };
type Facts = typeof answer.facts;
type Options = VoiceServiceOptions<string, Facts, string>;

function harness(options: Partial<Options> = {}) {
  let handlers: LiveHandlers | undefined;
  const onUsage = vi.fn<NonNullable<Options['onUsage']>>();
  const retrieve = vi.fn<Options['retrieve']>().mockResolvedValue(answer);
  const sendCommentary = vi.fn<(eventId: string, delegationId: string, text: string) => void>();
  const closeSession = vi.fn<VoiceAdapter['closeSession']>().mockImplementation(async () => {
    handlers?.onEvent({ type: 'closed', seconds: 16 });
  });
  const adapter = {
    createSession: vi.fn<VoiceAdapter['createSession']>().mockResolvedValue({ id: 'live_provider', sdp: 'answer' }),
    attach: vi.fn<VoiceAdapter['attach']>().mockImplementation(async (_id, nextHandlers) => {
      handlers = nextHandlers;
      return { sendCommentary, finish: async () => true };
    }),
    closeSession,
  };
  const service = createVoiceService<string, Facts, string>({ adapter, settleMs: 2, retrieve, onUsage, ...options });
  const receive = (event: LiveEvent) => handlers?.onEvent(event);
  function userSpeech(fragmentId: string, text: string, startMs: number, endMs: number) {
    receive({ type: 'transcript', fragment: { eventId: fragmentId, role: 'user', text, startMs, endMs } });
  }
  async function open() {
    const { id } = await service.start({ ...owner, sdp: 'offer' });
    const events: VoiceEvent<Facts>[] = [];
    const input = { ...owner, id };
    service.subscribe(input, (event) => events.push(event));
    return { input, events };
  }
  return { adapter, service, receive, userSpeech, open, retrieve, sendCommentary, onUsage,
    disconnect: () => handlers?.onDisconnect() };
}

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
      await vi.advanceTimersByTimeAsync(90);
      const [eventId] = mock.sendCommentary.mock.calls[0];
      mock.receive({ type: 'commentary_accepted', eventId });
      await vi.advanceTimersByTimeAsync(0);
      const result = events.find((event) => event.type === 'result');
      expect(result).toMatchObject({ result: { text: corrected } });
      expect(events).toContainEqual({ type: 'playback', turnId: 'corrected', allowed: true });
    } finally {
      await mock.service.closeAll();
      vi.useRealTimers();
    }
  });

  it('waits for late transcript fragments and the corresponding provider acknowledgment', async () => {
    const mock = harness();
    const { events } = await mock.open();
    mock.receive({ type: 'active' });
    mock.receive({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
    mock.userSpeech('fragment-1', 'Tugas', 250, 500);
    mock.userSpeech('fragment-2', ' yang selesai?', 500, 900);
    await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
    expect(mock.retrieve).toHaveBeenCalledWith(expect.objectContaining({ text: 'Tugas yang selesai?' }));
    expect(mock.sendCommentary.mock.calls[0].slice(1)).toEqual(['turn-1', answer.text]);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'result' }));
    mock.receive({ type: 'commentary_accepted', eventId: 'other-command' });
    expect(events).not.toContainEqual({ type: 'playback', turnId: 'turn-1', allowed: true });
    mock.receive({ type: 'commentary_accepted', eventId: mock.sendCommentary.mock.calls[0][0] });
    await vi.waitFor(() => expect(events.slice(-2)).toEqual([
      { type: 'result', turnId: 'turn-1', result: answer },
      { type: 'playback', turnId: 'turn-1', allowed: true },
    ]));
    mock.receive({ type: 'delegation', id: 'turn-1', offsetMs: 1_000 });
    expect(mock.retrieve).toHaveBeenCalledOnce();
    await mock.service.closeAll();
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
    expect(events).not.toContainEqual({ type: 'playback', turnId: 'before', allowed: true });
    mock.receive({ type: 'commentary_accepted', eventId: mock.sendCommentary.mock.calls[1][0] });
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ type: 'playback', turnId: 'after', allowed: true }));
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

  it('sends a safe fallback when retrieval times out and closes if Live rejects it', async () => {
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
    expect(events).not.toContainEqual({ type: 'playback', turnId: 'turn-1', allowed: true });
    await mock.service.closeAll();
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
