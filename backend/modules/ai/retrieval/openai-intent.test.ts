import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVoiceConfig } from '../config.js';
import type { CeoInterpretation } from './interpretation.js';
import { createOpenAiIntentInterpreter } from './openai-intent.js';

const input = {
  transcript: 'Bisa paparkan gambaran pekerjaan?',
  history: [{ role: 'user' as const, text: 'Yang dibahas timesheet perusahaan.' }],
  divisions: [{ id: 'ea0e00b0-101c-4000-8000-000000000001', name: 'IT', code: 'IT' }],
  currentTitleHints: ['Pembaruan Gerbang'],
  today: '2026-11-27',
};

const request: CeoInterpretation = {
  kind: 'lookup', operation: 'summary', target: 'division_or_company',
  subject: null, workKind: null, divisionId: null, from: null, to: null, asOf: null,
  statuses: [], selectionId: null, clarify: null, clear: [], correction: null, divisionExcerpt: null, summaryDetail: 'total',
};

function response(content: Record<string, unknown>, status = 'completed') {
  return Response.json({
    object: 'response',
    status,
    model: 'gpt-6-luna',
    service_tier: 'default',
    usage: {
      input_tokens: 1_000, output_tokens: 100,
      input_tokens_details: { cache_write_tokens: 1_000, cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    output: [{ type: 'message', role: 'assistant', content: [content] }],
  });
}

function harness(result: Response, timeoutMs = 6_000) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(result);
  vi.stubGlobal('fetch', fetch);
  const settle = vi.fn<(micros: number) => void>();
  const reserve = vi.fn<(micros: number) => (actualMicros: number) => void>().mockReturnValue(settle);
  const interpret = createOpenAiIntentInterpreter({
    apiKey: 'fixture-only', model: 'gpt-6-luna', budget: { reserve },
    timeoutMs,
    inputMicrosPerToken: 0.125, outputMicrosPerToken: 0.5,
  });
  return { fetch, settle, reserve, interpret };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('interpretasi semantik timesheet lewat Responses API', () => {
  it('uses the configured deadline and still honors an earlier caller cancellation', async () => {
    vi.useFakeTimers();
    const h = harness(response({ type: 'output_text', text: JSON.stringify(request) }), 8_000);
    h.fetch.mockImplementation((_url, init) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response({ type: 'output_text', text: JSON.stringify(request) })), 5_500);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    const first = expect(h.interpret(input)).resolves.toEqual(request);
    await vi.advanceTimersByTimeAsync(5_500);
    await first;

    const controller = new AbortController();
    const second = expect(h.interpret({ ...input, signal: controller.signal })).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(2_000);
    controller.abort();
    await second;
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('mengirim satu permintaan berformat ketat dan menagih berdasarkan pemakaian', async () => {
    const h = harness(response({ type: 'output_text', text: JSON.stringify(request) }));
    const observe = vi.fn();
    await expect(h.interpret({ ...input, observe })).resolves.toEqual(request);
    expect(h.fetch).toHaveBeenCalledOnce();
    const [url, init] = h.fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'gpt-6-luna', store: false, reasoning: { effort: 'none' }, service_tier: 'default',
      text: { format: { type: 'json_schema', strict: true, schema: { additionalProperties: false } } },
    });
    expect(body.max_output_tokens).toBeLessThanOrEqual(512);
    expect(body.text.format.schema.required).toEqual(Object.keys(request));
    expect(body.text.format.schema.properties.correction.anyOf[0]).toMatchObject({
      required: ['supersededSubject', 'bridge'], additionalProperties: false,
    });
    expect(JSON.parse(body.input)).toMatchObject({
      today: input.today, divisions: input.divisions, latest: input.transcript, history: input.history,
      currentTitleHints: ['Pembaruan Gerbang'],
    });
    expect(h.reserve.mock.calls[0][0]).toBeGreaterThan(175);
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(175);
    expect(observe).toHaveBeenCalledExactlyOnceWith({
      model: 'gpt-6-luna', serviceTier: 'default', reasoningTokens: 0,
      responseStatus: 'completed', incompleteReason: undefined, outputTokens: 100,
      validation: 'valid',
      responseErrorCode: undefined, outputTypes: ['output_text'], validationIssues: undefined,
      outputPhases: ['unspecified'],
    });
  });

  it('reads the final structured message while retaining separate commentary diagnostics', async () => {
    const body = await response({ type: 'output_text', text: JSON.stringify(request) }).json();
    body.output = [
      { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking the request.' }] },
      { ...body.output[0], phase: 'final_answer' },
    ];
    const h = harness(Response.json(body));
    const observe = vi.fn();
    await expect(h.interpret({ ...input, observe })).resolves.toEqual(request);
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      validation: 'valid', outputTypes: ['output_text', 'output_text'], outputPhases: ['commentary', 'final_answer'],
    }));
  });

  it.each(['conflicting_finals', 'commentary_only'])('rejects %s output without choosing a request', async (scenario) => {
    const body = await response({ type: 'output_text', text: JSON.stringify(request) }).json();
    body.output[0].phase = scenario === 'commentary_only' ? 'commentary' : 'final_answer';
    if (scenario === 'conflicting_finals') body.output.push({ ...body.output[0], content: [
      { type: 'output_text', text: JSON.stringify({ ...request, operation: 'pic' }) },
    ] });
    const h = harness(Response.json(body));
    await expect(h.interpret(input)).rejects.toBeInstanceOf(Error);
    expect(h.fetch).toHaveBeenCalledOnce();
  });

  it('sends only the scoped recheck evidence to the same model', async () => {
    const h = harness(response({ type: 'output_text', text: JSON.stringify(request) }));
    const scopeRecheck = { provisional: { ...request, subject: 'proyek Pembaruan Gerbang khusus',
      divisionId: input.divisions[0].id }, registeredTitle: 'Pembaruan Gerbang' };
    await expect(h.interpret({ ...input, scopeRecheck })).resolves.toEqual(request);
    expect(h.fetch).toHaveBeenCalledOnce();
    const [, init] = h.fetch.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('gpt-6-luna');
    expect(body.instructions).toMatch(/first removed scope word/u);
    expect(JSON.parse(body.input)).toEqual({ latest: input.transcript, divisions: input.divisions, scopeRecheck });
  });

  it.each([
    ['keluaran di luar skema', { type: 'output_text', text: JSON.stringify({ ...request, extra: 'tolak' }) }, 'completed', 'invalid_schema'],
    ['penolakan model', { type: 'refusal', refusal: 'Tidak dapat menentukan maksud.' }, 'completed', 'missing_output'],
    ['respons belum selesai', { type: 'output_text', text: JSON.stringify(request) }, 'incomplete', 'incomplete'],
    ['JSON rusak', { type: 'output_text', text: '{' }, 'completed', 'invalid_json'],
  ])('menghentikan proses pada %s dan tetap mencatat pemakaian', async (_, content, status, validation) => {
    const h = harness(response(content, status));
    const observe = vi.fn();
    await expect(h.interpret({ ...input, observe })).rejects.toBeInstanceOf(Error);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(175);
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ responseStatus: status, validation }));
    if (validation === 'invalid_schema') {
      expect(observe.mock.calls[0][0].validationIssues).toEqual([{ code: 'unrecognized_keys', path: '' }]);
    }
  });

  it('melepas cadangan biaya untuk permintaan yang ditolak API', async () => {
    const h = harness(Response.json({ error: { message: 'Invalid request' } }, { status: 400 }));
    await expect(h.interpret(input)).rejects.toMatchObject({ status: 400 });
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('menghormati pembatalan sebelum mencadangkan biaya atau memanggil API', async () => {
    const h = harness(response({ type: 'output_text', text: JSON.stringify(request) }));
    const signal = AbortSignal.abort(new Error('Sesi berakhir'));
    await expect(h.interpret({ ...input, signal })).rejects.toBe(signal.reason);
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('menjaga cadangan biaya Luna Standard saat tarif kosong atau di bawah batas', () => {
    const source = {
      AI_VOICE_ENABLED: 'true',
      OPENAI_API_KEY: 'fixture-only',
      OPENAI_VOICE_MODEL: 'gpt-live-1.1',
      OPENAI_INTENT_MODEL: 'gpt-6-luna',
    };
    const expected = { intentModel: 'gpt-6-luna', intentInputMicrosPerToken: 0.125, intentOutputMicrosPerToken: 0.5 };
    expect(readVoiceConfig(source)).toMatchObject(expected);
    expect(readVoiceConfig({
      ...source, AI_INTENT_INPUT_USD_PER_MILLION: '0.10', AI_INTENT_OUTPUT_USD_PER_MILLION: '0.1',
    })).toMatchObject(expected);
  });
});
