import type { DivisionRef } from './request-types.js';
import type { RetrievalDatabase } from './schema.js';
import { literalSpans, titleText } from './label-evidence.js';

export async function readDivisions(db: RetrievalDatabase) {
  const { rows } = await db.query<DivisionRef>('SELECT id, name, code FROM public.divisions ORDER BY name, id');
  return rows;
}

export function divisionsIn(text: string, divisions: DivisionRef[]) {
  return divisions.filter(({ name, code }) => literalSpans(text, titleText(name)).length
    || literalSpans(text, titleText(code)).length);
}
