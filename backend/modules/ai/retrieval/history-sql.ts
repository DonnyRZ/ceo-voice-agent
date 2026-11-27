import { addDays, startOfJakartaDay } from './calendar.js';
import type { CeoRequest } from './request-types.js';
import type { CeoFacts, RetrievalDatabase } from './schema.js';
import { timestamp } from './task-sql.js';

type StatusEventRow = Omit<CeoFacts['history'][number], 'changedAt'> & { changedAt: string | Date };

export async function readHistory(db: RetrievalDatabase, request: CeoRequest) {
  const entity = request.entity;
  if (!entity || entity.kind === 'division') return [];
  const from = request.period?.from ? startOfJakartaDay(request.period.from) : null;
  const lastDay = request.period?.to ?? request.asOf?.slice(0, 10);
  const to = lastDay ? startOfJakartaDay(addDays(lastDay, 1)) : null;
  const { rows } = await db.query<StatusEventRow>(`
    SELECT event.id, event.changed_at AS "changedAt", event.previous_status AS "previousStatus", event.status, event.actor_name AS "actorName"
    FROM public.ceo_work_status_history($1, $2::uuid, $3::timestamptz, $4::timestamptz, $5::int) AS event
    ORDER BY event.changed_at DESC, event.id::bigint DESC`, [entity.kind, entity.id, from, to, request.latest ? 1 : 12]);
  return rows.map((row) => ({ ...row, changedAt: timestamp(row.changedAt) }));
}
