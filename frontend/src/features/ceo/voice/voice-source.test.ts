import { describe, expect, it } from 'vitest';
import type { VoiceFacts } from './voice-protocol';
import { readVoiceEvent } from './voice-protocol';
import { voicePeriodLabel, voiceSourcePath } from './voice-source';

const facts: VoiceFacts = { intent: 'summary', tasks: [], history: [] };

describe('voice source presentation scope', () => {
  it('preserves historical cutoff in Jakarta and maps only complete calendar months', () => {
    const path = voiceSourcePath('project', 'source-id', {
      ...facts, asOf: '2026-11-26T20:00:00Z', period: { from: '2024-02-01', to: '2024-02-29' },
    });
    const url = new URL(path, 'http://localhost');
    expect(url.pathname).toBe('/ceo/projects/source-id');
    expect(Object.fromEntries(url.searchParams)).toEqual({ voiceAsOf: '2026-11-27', voiceFrom: '2024-02-01', voiceTo: '2024-02-29', month: '2024-02' });
    expect(voiceSourcePath('task', 'source-id', { ...facts, period: { from: '2024-02-02', to: '2024-02-29' } })).not.toContain('month=');
    expect(voiceSourcePath('division', 'source-id', facts)).toBe('/ceo/divisions/source-id');
  });

  it('distinguishes one-sided date ranges without missing endpoints', () => {
    expect(voicePeriodLabel({ from: '2026-11-01' })).toBe('Sejak 2026-11-01');
    expect(voicePeriodLabel({ to: '2026-11-30' })).toBe('Sampai 2026-11-30');
    expect(voicePeriodLabel(undefined)).toBeNull();
  });

  it('keeps backend status filters when validating a fact event', () => {
    const event = readVoiceEvent({ type: 'result', turnId: 'filtered', generation: 1,
      result: { kind: 'facts', text: 'Ada tujuh tugas selesai.', facts: { ...facts, statusFilter: ['done'], counts: { pending: 0, on_progress: 0, done: 7, total: 7 } } } });
    expect(event?.type === 'result' && event.result.kind === 'facts' && event.result.facts.statusFilter).toEqual(['done']);
  });
});
