import { describe, expect, it, vi } from 'vitest';
import { searchSemantic, type EmbedText } from './candidates.js';
import type { CeoRequest } from './request-types.js';

describe('semantic search query evidence', () => {
  it('retains the spoken purpose when the interpreted subject contains only a generic noun', async () => {
    const transcript = 'Bagaimana proyek agar ruang penyimpanan tahan kelembapan?';
    const request: CeoRequest = { intent: 'status', subject: 'ruang penyimpanan', entityKind: 'project', latest: false,
      division: { id: 'ea0e00b0-101c-4000-8000-000000000001', name: 'IT', code: 'IT' } };
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const embed = vi.fn<EmbedText>().mockResolvedValue({ model: 'fixture-embedding', vector: Array(1536).fill(0.1) });
    const result = await searchSemantic({ query }, request, embed, 1000, undefined, transcript);
    expect(result.outcome).toBe('observed');
    expect(embed).toHaveBeenCalledExactlyOnceWith(transcript, expect.any(AbortSignal));
    expect(query.mock.calls[0][1].slice(1)).toEqual(['fixture-embedding', request.division!.id, 'project']);
  });

  it('keeps the subject for callers without separate utterance evidence', async () => {
    const embed = vi.fn<EmbedText>().mockResolvedValue({ model: 'fixture-embedding', vector: Array(1536).fill(0.1) });
    await searchSemantic({ query: async () => ({ rows: [] }) }, { intent: 'status', subject: 'Cadangan data', latest: false }, embed, 1000);
    expect(embed).toHaveBeenCalledExactlyOnceWith('Cadangan data', expect.any(AbortSignal));
  });
});
