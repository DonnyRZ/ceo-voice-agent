import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { openBudget } from './budget.js';
import { readVoiceConfig } from './config.js';
import { createEmbedder, startEmbeddingWorker } from './embeddings.js';
import { createVoiceMetrics } from './metrics.js';
import { retrieveCeoAnswer, type CeoRetrievalContext } from './retrieval/index.js';
import type { InterpretCeoTurn } from './retrieval/interpretation.js';
import { createOpenAiIntentInterpreter } from './retrieval/openai-intent.js';
import type { CeoFacts } from './retrieval/schema.js';
import type { VoiceApi } from './routes.js';
import { createVoiceHistory } from './voice/history/store.js';
import { createLiveAdapter } from './voice/live-adapter.js';
import { budgetVoice } from './voice/runtime-budget.js';
import { authorizeVoice, retrievalDatabase } from './voice/runtime-database.js';
import { createVoiceService } from './voice/service.js';
import type { LiveEvent, VoiceAdapter, VoiceMetric } from './voice/types.js';
import { readVoiceVocabulary } from './voice/vocabulary.js';

export type VoiceAudit = {
  adapter?: VoiceAdapter;
  interpret?: InterpretCeoTurn;
  observe?(metric: VoiceMetric, turnId?: string): void;
  providerEvent?(event: LiveEvent): void;
  commentarySent?(eventId: string, delegationId: string, text: string): void;
};

export function contextWithoutUnplayedChoices(context: CeoRetrievalContext): CeoRetrievalContext {
  if (!context.choices) return context;
  return {
    request: context.request,
    pendingRequest: context.pendingRequest,
    needsConfirmation: context.needsConfirmation || context.choices.length > 0 || undefined,
  };
}

export function createVoiceRuntime(pool: Pool, log: FastifyBaseLogger, override?: VoiceApi, audit?: VoiceAudit) {
  const metrics = createVoiceMetrics();
  const config = override ? undefined : readVoiceConfig();
  if (!config) return { service: override, metrics, close: async () => override?.closeAll() };

  const { apiKey, voiceModel, testHistoryEnabled, embeddingModel, standbySeconds, maxDurationMs, budgetUsd } = config;
  // Keep the existing non-voice ledger so previously spent embedding budget is still counted.
  const textBudget = budgetUsd * 0.1;
  const permittedVoice = openBudget(budgetUsd - textBudget);
  const permittedText = openBudget(textBudget, '.voice-pilot/embeddings-budget.json');
  const interpret = audit?.interpret ?? createOpenAiIntentInterpreter({
    apiKey, model: config.intentModel, budget: permittedText,
    timeoutMs: config.retrievalTimeoutMs,
    inputMicrosPerToken: config.intentInputMicrosPerToken,
    outputMicrosPerToken: config.intentOutputMicrosPerToken,
  });
  const adapter = budgetVoice(audit?.adapter ?? createLiveAdapter({
    apiKey, model: voiceModel, idleTimeoutSeconds: standbySeconds,
    proxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy,
  }), permittedVoice, maxDurationMs, log, audit);
  const embedding = embeddingModel ? {
    model: embeddingModel,
    embed: createEmbedder(apiKey, embeddingModel, permittedText),
  } : undefined;
  const stopEmbeddings = embedding && startEmbeddingWorker(pool, embedding.model, embedding.embed, log);
  const history = testHistoryEnabled ? createVoiceHistory<CeoFacts>(pool, log, voiceModel) : undefined;

  function observe(metric: VoiceMetric, turnId?: string) {
    audit?.observe?.(metric, turnId);
    switch (metric.type) {
      case 'session':
        metrics.observe('session', metric.reason ?? metric.action);
        metrics.observe(`session_${metric.action}`, metric.reason ?? 'observed', metric.durationMs);
        log.info({ action: metric.action, reason: metric.reason, durationMs: metric.durationMs }, 'Sesi suara CEO');
        break;
      case 'retrieval':
        metrics.observe('retrieval', metric.outcome, metric.durationMs);
        break;
      case 'state':
        metrics.observe('state', metric.state);
        break;
      case 'delegation':
        metrics.observe('delegation', metric.action);
        break;
      case 'latency':
        metrics.observe(metric.stage, metric.outcome, metric.durationMs);
        break;
    }
  }

  const service = createVoiceService<CeoRetrievalContext, CeoFacts>({
    adapter,
    maxDurationMs,
    maxSessions: 1,
    retrievalTimeoutMs: config.retrievalTimeoutMs,
    authorize: (owner) => authorizeVoice(pool, owner),
    loadVocabulary: async (owner, signal) => {
      try {
        return await readVoiceVocabulary(retrievalDatabase(pool, owner, signal));
      } catch {
        signal.throwIfAborted();
        log.debug('Daftar ejaan timesheet tidak tersedia untuk sesi baru.');
      }
    },
    contextWithoutAudio: contextWithoutUnplayedChoices,
    retrieve: ({ userId, sessionKey, text, history, context, signal, observePhase }) => retrieveCeoAnswer({
      db: retrievalDatabase(pool, { userId, sessionKey }, signal),
      transcript: text,
      history,
      interpret,
      context,
      signal,
      observePhase,
      embeddingDeadlineMs: Math.min(2_000, config.retrievalTimeoutMs),
      embed: embedding && (async (query, abort) => ({
        model: embedding.model, vector: await embedding.embed(query, abort),
      })),
    }),
    onMetric: observe,
    onHistory: history?.record,
    onUsage: ({ seconds, final }) => {
      if (final) metrics.bill(seconds);
    },
  });
  return {
    service,
    metrics,
    close: async () => {
      try {
        await Promise.all([service.closeAll(), stopEmbeddings?.()]);
      } finally {
        await history?.close();
      }
    },
  };
}
