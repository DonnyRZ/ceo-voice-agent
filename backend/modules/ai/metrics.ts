import { Counter, Histogram, Registry } from 'prom-client';

export function createVoiceMetrics() {
  const registry = new Registry();
  const actions = new Counter({
    name: 'ruang_kerja_ceo_voice_actions_total',
    help: 'Aktivitas sesi dan delegasi CEO.',
    labelNames: ['stage', 'outcome'] as const,
    registers: [registry],
  });
  const latency = new Histogram({
    name: 'ruang_kerja_ceo_voice_latency_seconds',
    help: 'Durasi tahap backend atau proksi pemutaran browser.',
    labelNames: ['stage', 'outcome'] as const,
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
    registers: [registry],
  });
  const voiceSeconds = new Counter({
    name: 'ruang_kerja_ceo_voice_billed_seconds_total',
    help: 'Detik penggunaan Live yang dikonfirmasi oleh event terminal.',
    registers: [registry],
  });

  return {
    registry,
    observe(stage: string, outcome: string, durationMs?: number) {
      actions.inc({ stage, outcome });
      if (durationMs !== undefined) latency.observe({ stage, outcome }, durationMs / 1000);
    },
    bill(seconds: number) {
      voiceSeconds.inc(seconds);
    },
  };
}
