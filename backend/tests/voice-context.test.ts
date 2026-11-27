import { describe, expect, it, vi } from 'vitest';
import type { CeoRetrievalContext } from '../modules/ai/retrieval/index.js';
import { contextWithoutUnplayedChoices } from '../modules/ai/voice-runtime.js';
import { deliverVerifiedAudio } from './voice-output-fixture.js';
import { answer, harnessWithContext, type Options } from './voice-service-fixture.js';

const request = { intent: 'status', subject: 'atlas', latest: false } as const;
const pendingRequest = { intent: 'status', subject: 'gerbang', latest: false } as const;
const choices = [{ id: 'gerbang-a', kind: 'project', name: 'Gerbang A', divisionId: 'it' }] as const;

describe('CEO voice request context', () => {
  it.each([
    ['clarify', false], ['no_match', false], ['clarify', true],
  ] as const)('carries the latest %s context with audio verified: %s', async (kind, verified) => {
    const unresolved: CeoRetrievalContext = kind === 'clarify'
      ? { request, pendingRequest, choices: [...choices] } : { request, pendingRequest };
    const text = 'Proyek mana yang ingin Anda lihat?';
    const retrieve = vi.fn<Options<CeoRetrievalContext>['retrieve']>()
      .mockResolvedValueOnce({ ...answer, context: { request } })
      .mockResolvedValueOnce({ kind, text, context: unresolved })
      .mockResolvedValue(answer);
    const mock = harnessWithContext({ retrieve, contextWithoutAudio: contextWithoutUnplayedChoices, outputTimeoutMs: 600 });
    try {
      const { events, input } = await mock.open();
      mock.userSpeech('atlas', 'Status proyek Atlas?', 0, 800);
      mock.receive({ type: 'delegation', id: 'confirmed', offsetMs: 1_000 });
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledOnce());
      deliverVerifiedAudio(mock.receive, mock.sendCommentary.mock.calls[0][0], answer.text);
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', allowed: true }));

      mock.userSpeech('gerbang', 'Status proyek Gerbang?', 3_400, 4_100);
      mock.receive({ type: 'delegation', id: 'unresolved', offsetMs: 4_300 });
      await vi.waitFor(() => expect(mock.sendCommentary).toHaveBeenCalledTimes(2));
      const [commandId] = mock.sendCommentary.mock.calls[1];
      if (verified) deliverVerifiedAudio(mock.receive, commandId, text, 4_600);
      else mock.receive({ type: 'commentary_accepted', eventId: commandId });
      await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'playback', turnId: 'unresolved', allowed: verified }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'result', turnId: 'unresolved', result: { kind, text } }));
      if (!verified) await expect(mock.service.takeAudio(input, { turnId: 'unresolved', generation: 2 })).resolves.toBeUndefined();

      mock.userSpeech('date', 'Per kemarin saja.', 6_400, 7_000);
      mock.receive({ type: 'delegation', id: 'followup', offsetMs: 7_300 });
      await vi.waitFor(() => expect(retrieve).toHaveBeenCalledTimes(3));
      const context = retrieve.mock.calls[2][0].context;
      expect(context?.request).toBe(request);
      expect(context?.pendingRequest).toBe(pendingRequest);
      expect(context?.choices).toEqual(verified ? choices : undefined);
      if (kind === 'clarify' && !verified) expect(context?.needsConfirmation).toBe(true);
    } finally {
      await mock.service.closeAll();
    }
  });
});
