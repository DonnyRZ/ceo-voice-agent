import { z } from 'zod/mini';

const status = z.enum(['pending', 'on_progress', 'done']);

const facts = z.object({
  intent: z.enum(['status', 'pic', 'summary', 'history']),
  entity: z.optional(z.object({
    kind: z.enum(['project', 'task', 'division']),
    id: z.string(),
    name: z.string(),
    divisionName: z.optional(z.string()),
  })),
  period: z.optional(z.object({ from: z.optional(z.string()), to: z.optional(z.string()) })),
  asOf: z.optional(z.string()),
  status: z.optional(status),
  updatedAt: z.optional(z.string()),
  evidenceId: z.optional(z.string()),
  picName: z.optional(z.nullable(z.string())),
  counts: z.optional(z.object({ pending: z.number(), on_progress: z.number(), done: z.number(), total: z.number() })),
  statusFilter: z.optional(z.array(status)),
  tasks: z._default(z.array(z.object({
    id: z.string(), title: z.string(), projectId: z.string(), projectName: z.string(),
    divisionId: z.string(), divisionName: z.string(), date: z.string(), status,
    picName: z.nullable(z.string()), updatedAt: z.string(),
  })), []),
  history: z._default(z.array(z.object({
    id: z.string(), changedAt: z.string(), previousStatus: z.nullable(status), status,
    actorName: z.nullable(z.string()),
  })), []),
});

const result = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('facts'), text: z.string(), facts }),
  z.object({ kind: z.enum(['clarify', 'no_match', 'unsupported', 'unavailable']), text: z.string() }),
]);

const stages = z.enum(['connecting', 'active', 'standby', 'closed', 'unavailable']);
const reasons = z.enum(['revoked', 'ended', 'timeout', 'unavailable']);
const turnId = z.string().check(z.minLength(1));
const turn = { turnId, generation: z.int().check(z.minimum(1)) };
const event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: stages, reason: z.optional(reasons) }),
  z.object({ type: z.literal('turn'), ...turn }),
  z.object({ type: z.literal('result'), ...turn, result }),
  z.object({ type: z.literal('playback'), ...turn, allowed: z.boolean(), reason: z.optional(z.literal('unverified')) }),
]);

export type VoiceFacts = z.infer<typeof facts>;
export type VoiceResult = z.infer<typeof result>;
export type VoiceStage = 'idle' | z.infer<typeof stages>;
export type VoiceEvent = z.infer<typeof event>;
export type VoiceCloseReason = z.infer<typeof reasons>;

export function readVoiceEvent(data: unknown): VoiceEvent | null {
  try {
    const parsed = event.safeParse(typeof data === 'string' ? JSON.parse(data) : data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
