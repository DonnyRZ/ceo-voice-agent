import { z } from 'zod';

const boolean = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const environment = z.object({
  AI_VOICE_ENABLED: boolean,
  AI_VOICE_TEST_HISTORY_ENABLED: boolean,
  AI_VOICE_STANDBY_SECONDS: z.coerce.number().int().min(5).max(60).default(12),
  AI_VOICE_MAX_DURATION_SECONDS: z.coerce.number().int().min(15).max(600).default(600),
  AI_EMBEDDINGS_ENABLED: boolean,
  AI_OPENAI_BUDGET_USD: z.coerce.number().positive().max(5).default(5),
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_VOICE_MODEL: z.string().trim().min(1),
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
  return {
    apiKey: config.OPENAI_API_KEY,
    voiceModel: config.OPENAI_VOICE_MODEL,
    testHistoryEnabled: config.AI_VOICE_TEST_HISTORY_ENABLED,
    embeddingModel: config.AI_EMBEDDINGS_ENABLED ? config.OPENAI_EMBEDDING_MODEL : undefined,
    standbySeconds: config.AI_VOICE_STANDBY_SECONDS,
    maxDurationMs: config.AI_VOICE_MAX_DURATION_SECONDS * 1000,
    budgetUsd: config.AI_OPENAI_BUDGET_USD,
  };
}
