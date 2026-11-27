import { describe, expect, it, vi } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import type { CeoInterpretation, InterpretCeoTurn } from './interpretation.js';
import { now, mobile, empty, lookup, interpreter, exactRead, interpretationRead, database } from './retrieval-test-fixture.js';

describe('CEO semantic providers, cancellation and authorized snapshots', () => {
  it('keeps vector candidates non-factual and times out a slow provider', async () => {
    const { db } = database([]);
    const interpret = interpreter(lookup({ subject: 'tambang' }));
    const transcript = 'Proyek tambang itu sudah sampai di tahap mana?';
    const embed = vi.fn(async () => ({ model: 'embedding-test', vector: Array<number>(1536).fill(1) }));
    const first = await retrieveCeoAnswer({ db, interpret, now, transcript, embed });
    expect(first.kind).toBe('clarify');
    expect(first.facts).toBeUndefined();
    const slow = vi.fn<NonNullable<Parameters<typeof retrieveCeoAnswer>[0]['embed']>>(() => new Promise(() => {}));
    const second = await retrieveCeoAnswer({ db, interpret, now, transcript, embed: slow, embeddingDeadlineMs: 20 });
    expect(second.kind).toBe('unavailable');
    expect(second.facts).toBeUndefined();
    expect(slow).toHaveBeenCalledOnce();
  });

  it('suggests the seeded synonym project when the full utterance produces a vector after the old deadline', async () => {
    const expected = { ...mobile, id: 'ea0e00b0-301c-4000-8000-000000000351', name: 'Pemulihan Layanan Pesan', score: 0.69 };
    const { db, calls } = database([], [expected]);
    const subject = 'yang menolong pegawai mendapatkan kembali surel yang hilang';
    const observePhase = vi.fn();
    const result = await retrieveCeoAnswer({
      db, now, transcript: `Bagaimana progres proyek ${subject}`, interpret: interpreter(lookup({ subject })), observePhase,
      embed: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        return { model: 'embedding-test', vector: Array<number>(1536).fill(1) };
      },
    });
    expect(result.kind).toBe('clarify');
    expect(result.context.choices).toEqual([expect.objectContaining({ id: expected.id, name: expected.name })]);
    expect(result.facts).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
    expect(observePhase).toHaveBeenCalledWith(expect.objectContaining({ stage: 'semantic_lookup', outcome: 'observed' }));
  });

  it('distinguishes an empty semantic lookup from an interrupted lookup and retains lexical options', async () => {
    const subject = 'jalur pengambilan pesan';
    const base = { now, transcript: `Status proyek ${subject}?`, interpret: interpreter(lookup({ subject })) };
    const success = async () => ({ model: 'embedding-test', vector: Array<number>(1536).fill(1) });
    const noMatches = await retrieveCeoAnswer({ ...base, db: database([], []).db, embed: success });
    expect(noMatches.kind).toBe('no_match');
    const observePhase = vi.fn();
    const unavailable = await retrieveCeoAnswer({ ...base, db: database([]).db, observePhase,
      embed: async () => { throw new Error('Unavailable'); } });
    expect(unavailable.kind).toBe('unavailable');
    expect(observePhase).toHaveBeenCalledWith(expect.objectContaining({ stage: 'semantic_lookup', outcome: 'error' }));
    const lexical = await retrieveCeoAnswer({ ...base, db: database([{ ...mobile, score: 0.62 }]).db, observePhase,
      embeddingDeadlineMs: 10, embed: () => new Promise(() => {}) });
    expect(lexical.kind).toBe('clarify');
    expect(lexical.context.choices?.map(({ id }) => id)).toEqual([mobile.id]);
    expect(observePhase).toHaveBeenCalledWith(expect.objectContaining({ stage: 'semantic_lookup', outcome: 'timeout' }));
  });

  it.each(['success', 'error'] as const)('refreshes lexical candidates after the embedding request returns: %s', async (provider) => {
    const candidates = [{ ...mobile, score: 0.62 }];
    const { db } = database(candidates, []);
    db.withSnapshot = (read) => read(db);
    const subject = 'pemulihan pesan';
    const result = await retrieveCeoAnswer({ db, now, transcript: `Status proyek ${subject}?`,
      interpret: interpreter(lookup({ subject })), embed: async () => {
        candidates.length = 0;
        if (provider === 'error') throw new Error('Unavailable');
        return { model: 'embedding-test', vector: Array<number>(1536).fill(1) };
      } });
    expect(result.kind).toBe(provider === 'success' ? 'no_match' : 'unavailable');
    expect(result.context.choices).toBeUndefined();
  });

  it('runs database reads inside authorized snapshots without enclosing inference or embedding', async () => {
    const { db } = database([]);
    let insideSnapshot = false;
    db.withSnapshot = async (read) => {
      insideSnapshot = true;
      try {
        return await read(db);
      } finally {
        insideSnapshot = false;
      }
    };
    const lookupQuery = db.query;
    db.query = (sql, parameters) => {
      if (exactRead(sql) || sql.includes('ceo_search_work') || sql.includes('work_search_embeddings')) expect(insideSnapshot).toBe(true);
      return lookupQuery(sql, parameters);
    };
    const result = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Katalog Biometrik?',
      interpret: async () => {
        expect(insideSnapshot).toBe(false);
        return lookup({ subject: 'Katalog Biometrik' });
      },
      embed: async () => {
        expect(insideSnapshot).toBe(false);
        return { model: 'embedding-test', vector: Array<number>(1536).fill(1) };
      },
    });
    expect(result.kind).toBe('clarify');
    expect(result.facts).toBeUndefined();
  });

  it('does not search for facts when the configured interpreter fails', async () => {
    const { db, calls } = database();
    const failure = new Error('Interpreter unavailable');
    const interpret = vi.fn<InterpretCeoTurn>().mockRejectedValue(failure);
    const embed = vi.fn();
    await expect(retrieveCeoAnswer({
      db, interpret, now, embed, transcript: 'Apa status proyek Aplikasi A Mobile?',
    })).rejects.toBe(failure);
    expect(interpret).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(2);
    expect(calls.every(interpretationRead)).toBe(true);
    expect(embed).not.toHaveBeenCalled();
  });

  it('records a timed-out inference once and discards its late result', async () => {
    const { db, calls } = database();
    const controller = new AbortController();
    const deadline = new DOMException('Retrieval took too long.', 'TimeoutError');
    const observePhase = vi.fn();
    let finish!: (decision: CeoInterpretation) => void;
    const interpret = vi.fn<InterpretCeoTurn>(() => new Promise((resolve) => { finish = resolve; }));
    const result = retrieveCeoAnswer({
      db, interpret, now, transcript: 'Aplikasi A Mobile itu sudah sampai mana?', signal: controller.signal, observePhase,
    });
    await vi.waitFor(() => expect(interpret).toHaveBeenCalledOnce());
    controller.abort(deadline);
    expect(observePhase).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'intent_inference', outcome: 'timeout' }));
    finish(lookup());
    await expect(result).rejects.toBe(deadline);
    expect(observePhase).toHaveBeenCalledTimes(2);
    expect(calls.every(interpretationRead)).toBe(true);
  });
});
