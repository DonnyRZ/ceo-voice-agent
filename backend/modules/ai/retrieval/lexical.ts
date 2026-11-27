import type { Candidate } from './candidates.js';
import type { CeoRequest, WorkKind } from './request-types.js';
import type { RetrievalDatabase } from './schema.js';

type SearchRow = Omit<Candidate, 'source'> & { coverage?: number };
const maximumLexicalTerms = 12;

export async function searchLexical(db: RetrievalDatabase, request: CeoRequest): Promise<Candidate[]> {
  if (!request.subject) return [];
  const kinds: WorkKind[] = request.entityKind ? [request.entityKind] : ['project', 'task'];
  // Bounded per-term counts rank discriminating lexemes without maintaining a stop-word list.
  // The caller presents these matches as choices after its separate full-title proof.
  const results = await Promise.all(kinds.map((kind) => db.query<SearchRow>(`
    WITH query_terms AS MATERIALIZED (
      SELECT tsvector_to_array(to_tsvector('simple', $2::text)) AS lexemes
    ), terms AS MATERIALIZED (
      SELECT lexeme FROM query_terms, unnest(lexemes) AS lexeme
      ORDER BY length(lexeme) DESC, lexeme LIMIT $5
    ), probes AS (
      SELECT $2::text AS needle, true AS full_subject
      UNION ALL
      SELECT lexeme, false FROM terms
    ), matches AS MATERIALIZED (
      SELECT probe.needle, probe.full_subject, matched.*
      FROM probes AS probe
      CROSS JOIN LATERAL public.ceo_search_work($1::text, probe.needle, $3::uuid, $4::timestamptz, false) AS matched
    ), term_weights AS MATERIALIZED (
      SELECT terms.lexeme, 1.0 / (1 + count(DISTINCT matched.id)) AS weight
      FROM terms LEFT JOIN matches AS matched
        ON NOT matched.full_subject AND matched.needle = terms.lexeme AND matched.score >= 0.63
      GROUP BY terms.lexeme
    ), total_weight AS (
      SELECT coalesce(sum(weight), 0) + greatest(cardinality(query_terms.lexemes) - count(weight), 0) AS weight
      FROM query_terms LEFT JOIN term_weights ON true GROUP BY query_terms.lexemes
    ), candidates AS (
      SELECT matched.id, matched.name, matched.division_id,
        max(CASE WHEN matched.full_subject THEN matched.score ELSE 0 END) AS full_score,
        coalesce(sum(term_weights.weight) FILTER (WHERE matched.score >= 0.82), 0) AS title_weight,
        coalesce(sum(term_weights.weight) FILTER (WHERE matched.score >= 0.63), 0) AS text_weight,
        count(DISTINCT matched.needle) FILTER (WHERE NOT matched.full_subject AND matched.score >= 0.82) AS title_terms,
        count(DISTINCT matched.needle) FILTER (WHERE NOT matched.full_subject AND matched.score >= 0.63) AS text_terms
      FROM matches AS matched LEFT JOIN term_weights
        ON NOT matched.full_subject AND term_weights.lexeme = matched.needle
      GROUP BY matched.id, matched.name, matched.division_id
    ), ranked AS (
      SELECT candidates.*,
        coalesce(greatest(0.82 * title_weight, 0.63 * text_weight) / nullif(total_weight.weight, 0), 0) AS coverage,
        greatest(candidates.full_score, 0.82 * title_terms / greatest(cardinality(query_terms.lexemes), 1),
          0.63 * text_terms / greatest(cardinality(query_terms.lexemes), 1))::double precision AS score
      FROM candidates CROSS JOIN total_weight CROSS JOIN query_terms
    )
    SELECT $1::text AS kind, matched.id, matched.name, matched.division_id::text AS "divisionId",
      division.name AS "divisionName", matched.score,
      matched.coverage::double precision AS coverage
    FROM ranked AS matched JOIN public.divisions AS division ON division.id = matched.division_id
    WHERE $4::timestamptz IS NOT NULL OR division.status = 'active'
    ORDER BY matched.coverage DESC, score DESC, matched.name, matched.id LIMIT 8`,
  [kind, request.subject, request.division?.id ?? null, request.asOf ?? null, maximumLexicalTerms])));
  return results.flatMap(({ rows }) => rows.map((row) => ({ ...row, source: 'lexical' as const })))
    .sort((left, right) => (right.coverage ?? 0) - (left.coverage ?? 0) || right.score - left.score
      || left.name.localeCompare(right.name, 'id') || left.id.localeCompare(right.id));
}
