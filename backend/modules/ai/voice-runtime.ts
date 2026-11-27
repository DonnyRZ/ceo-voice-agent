import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { inTransaction } from '../../db/transaction.js';
import { loadCeoIdentity } from '../auth/ceo-access.js';
import { activeVoiceMicros, openBudget, type OpenAiBudget } from './budget.js';
import { readVoiceConfig } from './config.js';
import { createEmbedder, startEmbeddingWorker } from './embeddings.js';
import { createVoiceMetrics } from './metrics.js';
import { prepareCeoCandidates, retrieveCeoAnswer, type CeoCandidatePreparation, type CeoRetrievalContext } from './retrieval/index.js';
import type { CeoFacts, RetrievalDatabase } from './retrieval/schema.js';
import type { VoiceApi } from './routes.js';
import { createVoiceHistory } from './voice/history/store.js';
import { createLiveAdapter, LiveCreateHttpError } from './voice/live-adapter.js';
import { createVoiceService } from './voice/service.js';
import type { VoiceAdapter, VoiceMetric, VoiceOwner } from './voice/types.js';

function budgetVoice(
  adapter: VoiceAdapter, budget: OpenAiBudget, maxDurationMs: number, log: FastifyBaseLogger,
): VoiceAdapter {
  const reservations = new Map<string, (micros: number) => void>();
  const settleFinal = (id: string, seconds: number | undefined) => {
    if (seconds === undefined) return;
    try {
      reservations.get(id)?.(activeVoiceMicros(seconds));
    } catch {
      log.warn('Penggunaan OpenAI belum dapat disimpan. Cadangan anggaran tetap ditahan.');
    } finally {
      reservations.delete(id);
    }
  };
  return {
    async createSession(sdp, signal) {
      // Keep the remaining allowance reserved until Live confirms final usage.
      const settle = budget.reserve(activeVoiceMicros(Math.max(15, maxDurationMs / 1000)), true);
      try {
        const started = await adapter.createSession(sdp, signal);
        reservations.set(started.id, settle);
        return started;
      } catch (error) {
        if (error instanceof LiveCreateHttpError) {
          log.warn({ status: error.status }, 'Pembukaan sesi GPT Live ditolak.');
          if (error.status < 500) settle(0);
        }
        throw error;
      }
    },
    attach(id, handlers, signal) {
      return adapter.attach(id, {
        ...handlers,
        onEvent(event) {
          if (event.type === 'closed') settleFinal(id, event.seconds);
          handlers.onEvent(event);
        },
      }, signal);
    },
    async closeSession(id, sideband, onEvent) {
      await adapter.closeSession(id, sideband, (event) => {
        if (event.type === 'closed') settleFinal(id, event.seconds);
        onEvent?.(event);
      });
      reservations.delete(id);
    },
  };
}

function authorize(pool: Pool, { userId, sessionKey }: VoiceOwner) {
  return inTransaction(pool, async (db) => {
    await db.query("SET LOCAL statement_timeout = '250ms'");
    return !!await loadCeoIdentity(db, userId, sessionKey);
  }, { readOnly: true });
}

function retrievalDatabase(pool: Pool, owner: VoiceOwner, signal: AbortSignal): RetrievalDatabase {
  return {
    query: (sql, parameters) => inTransaction(pool, async (db) => {
      signal.throwIfAborted();
      await db.query("SET LOCAL statement_timeout = '250ms'");
      const actor = await loadCeoIdentity(db, owner.userId, owner.sessionKey);
      if (!actor) throw new Error('Akses CEO berakhir.');
      signal.throwIfAborted();
      return db.query(sql, parameters);
    }, { readOnly: true }),
  };
}

export type VoiceAudit = {
  adapter: VoiceAdapter;
  observe?(metric: VoiceMetric): void;
};

export function createVoiceRuntime(pool: Pool, log: FastifyBaseLogger, override?: VoiceApi, audit?: VoiceAudit) {
  const metrics = createVoiceMetrics();
  const config = override ? undefined : readVoiceConfig();
  if (!config) return { service: override, metrics, close: async () => override?.closeAll() };

  const { apiKey, voiceModel, testHistoryEnabled, embeddingModel, standbySeconds, maxDurationMs, budgetUsd } = config;
  // Keep the same split across restarts even when indexing is disabled.
  const embeddingBudget = budgetUsd * 0.1;
  const permittedVoice = openBudget(budgetUsd - embeddingBudget);
  const adapter = budgetVoice(audit?.adapter ?? createLiveAdapter({
    apiKey, model: voiceModel, idleTimeoutSeconds: standbySeconds,
    proxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy,
  }), permittedVoice, maxDurationMs, log);
  const embedding = embeddingModel ? {
    model: embeddingModel,
    embed: createEmbedder(apiKey, embeddingModel,
      openBudget(embeddingBudget, '.voice-pilot/embeddings-budget.json')),
  } : undefined;
  const stopEmbeddings = embedding && startEmbeddingWorker(pool, embedding.model, embedding.embed, log);
  const history = testHistoryEnabled ? createVoiceHistory<CeoFacts>(pool, log, voiceModel) : undefined;

  function observe(metric: VoiceMetric) {
    audit?.observe?.(metric);
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

  const service = createVoiceService<CeoRetrievalContext, CeoFacts, CeoCandidatePreparation>({
    adapter,
    maxDurationMs,
    maxSessions: 1,
    retrievalTimeoutMs: 900,
    authorize: (owner) => authorize(pool, owner),
    prepare: ({ userId, sessionKey, text, context, signal }) => prepareCeoCandidates({
      db: retrievalDatabase(pool, { userId, sessionKey }, signal),
      transcript: text,
      context,
      signal,
    }),
    retrieve: ({ userId, sessionKey, text, context, signal, prepared }) => retrieveCeoAnswer({
      db: retrievalDatabase(pool, { userId, sessionKey }, signal),
      transcript: text,
      context,
      signal,
      prepared,
      embeddingDeadlineMs: 250,
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
