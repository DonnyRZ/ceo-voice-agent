import { z } from 'zod';

const boolean = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const environment = z.object({
  AI_VOICE_ENABLED: boolean,
  AI_VOICE_TEST_HISTORY_ENABLED: boolean,
  AI_VOICE_STANDBY_SECONDS: z.coerce.number().int().min(5).max(60).default(12),
  AI_VOICE_MAX_DURATION_SECONDS: z.coerce.number().int().min(15).max(600).default(600),
  AI_VOICE_RETRIEVAL_TIMEOUT_MS: z.coerce.number().int().min(300).max(8000).default(6000),
  AI_EMBEDDINGS_ENABLED: boolean,
  AI_OPENAI_BUDGET_USD: z.coerce.number().positive().default(5),
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_VOICE_MODEL: z.string().trim().min(1),
  OPENAI_INTENT_MODEL: z.string().trim().min(1),
  AI_INTENT_INPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  AI_INTENT_OUTPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().trim().optional(),
}).refine((config) => !config.AI_EMBEDDINGS_ENABLED || !!config.OPENAI_EMBEDDING_MODEL, {
  path: ['OPENAI_EMBEDDING_MODEL'],
});

export function readVoiceConfig(source: NodeJS.ProcessEnv = process.env) {
  if (!source.AI_VOICE_ENABLED || source.AI_VOICE_ENABLED === 'false') return undefined;

  const result = environment.safeParse(source);
  if (!result.success) {
    throw new Error('Periksa konfigurasi Voice Agent: ' +
      result.error.issues.map((issue) => issue.path.join('.')).join(', '));
  }
  const config = result.data;
  const luna = config.OPENAI_INTENT_MODEL === 'gpt-6-luna';
  // Luna Standard cache writes cost $0.125 per million input tokens.
  const standardInput = luna ? 0.125 : 0.75;
  const standardOutput = luna ? 0.5 : 4.5;
  const requestedInput = config.AI_INTENT_INPUT_USD_PER_MILLION ?? standardInput;
  const requestedOutput = config.AI_INTENT_OUTPUT_USD_PER_MILLION ?? standardOutput;
  return {
    apiKey: config.OPENAI_API_KEY,
    voiceModel: config.OPENAI_VOICE_MODEL,
    intentModel: config.OPENAI_INTENT_MODEL,
    intentInputMicrosPerToken: luna ? Math.max(standardInput, requestedInput) : requestedInput,
    intentOutputMicrosPerToken: luna ? Math.max(standardOutput, requestedOutput) : requestedOutput,
    testHistoryEnabled: config.AI_VOICE_TEST_HISTORY_ENABLED,
    embeddingModel: config.AI_EMBEDDINGS_ENABLED ? config.OPENAI_EMBEDDING_MODEL : undefined,
    standbySeconds: config.AI_VOICE_STANDBY_SECONDS,
    maxDurationMs: config.AI_VOICE_MAX_DURATION_SECONDS * 1000,
    retrievalTimeoutMs: config.AI_VOICE_RETRIEVAL_TIMEOUT_MS,
    budgetUsd: config.AI_OPENAI_BUDGET_USD,
  };
}
