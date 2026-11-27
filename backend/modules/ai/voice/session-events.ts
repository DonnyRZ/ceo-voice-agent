import type { VoiceHistoryEntry } from './history/entry.js';
import type { createVoiceInput } from './input.js';
import type { VoiceTurns } from './turn.js';
import type { LiveEvent, VoiceCloseReason, VoiceState } from './types.js';

type EventControls<Facts> = {
  closed(): boolean;
  state(): VoiceState;
  record(entry: VoiceHistoryEntry<Facts>): void;
  changeState(state: 'active' | 'standby'): void;
  usage(seconds: number, final: boolean): void;
  providerClosed(reason: VoiceCloseReason): void;
};

export function createSessionEvents<Context, Facts, Prepared>(
  turns: VoiceTurns<Context, Facts, Prepared>,
  input: ReturnType<typeof createVoiceInput<Context, Facts, Prepared>>,
  controls: EventControls<Facts>,
) {
  let sentFinalUsage = false;
  return (event: LiveEvent) => {
    if (event.type === 'usage' || event.type === 'closed') {
      const final = event.type === 'closed';
      if (event.seconds !== undefined && !sentFinalUsage) {
        controls.record({ type: 'usage', seconds: event.seconds, final });
        controls.usage(event.seconds, final);
        sentFinalUsage = final;
      }
      if (event.type === 'closed') {
        controls.providerClosed(event.reason ?? 'ended');
      }
      return;
    }
    if (controls.closed()) return;

    switch (event.type) {
      case 'active':
      case 'standby':
        if (event.type === 'standby') {
          turns.invalidate('standby');
          turns.cancelPreparation();
          input.pause();
        }
        controls.changeState(event.type);
        break;
      case 'transcript':
        if (event.fragment.role === 'assistant' && controls.state() === 'active') {
          turns.commentary.output.appendTranscript(event.fragment);
        }
        // A valid input transcript confirms inference is awake even when the resume event is absent.
        if (input.append(event.fragment) && event.fragment.role === 'user' && controls.state() === 'standby') {
          controls.changeState('active');
        }
        break;
      case 'output_audio':
        if (controls.state() === 'active') turns.commentary.output.appendAudio(event.frame);
        break;
      case 'provider_error':
        controls.record(event);
        break;
      case 'delegation':
        input.delegate(event.id, event.offsetMs);
        break;
      case 'commentary_accepted':
        turns.commentary.observe(event.eventId, true, event.endMs);
        break;
      case 'commentary_rejected':
        turns.commentary.observe(event.eventId, false);
        break;
    }
  };
}
