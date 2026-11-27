import { vi } from 'vitest';
import { createVoiceService } from '../modules/ai/voice/service.js';
import type { LiveEvent, LiveHandlers, VoiceAdapter, VoiceEvent, VoiceServiceOptions } from '../modules/ai/voice/types.js';

export const owner = { userId: 'ceo', sessionKey: 'login-1' };
export const answer = { kind: 'facts' as const, text: 'Dua tugas selesai.', facts: { count: 2 } };
type Facts = typeof answer.facts;
export type Options<Context = string> = VoiceServiceOptions<Context, Facts, string>;

export function harnessWithContext<Context>(options: Partial<Options<Context>> = {}) {
  let handlers: LiveHandlers | undefined;
  const onUsage = vi.fn<NonNullable<Options['onUsage']>>();
  const retrieve = vi.fn<Options<Context>['retrieve']>().mockResolvedValue(answer);
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
  const service = createVoiceService<Context, Facts, string>({ adapter, settleMs: 2, retrieve, onUsage, ...options });
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

export const harness = harnessWithContext<string>;
