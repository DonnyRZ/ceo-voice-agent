\set ON_ERROR_STOP on
\echo 'Canonical identity audit on temporary synthetic tables'
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';

CREATE TEMP TABLE rk_utterance_span (key text COLLATE "C" PRIMARY KEY) ON COMMIT DROP;

CREATE FUNCTION pg_temp.rk_title_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT btrim(regexp_replace(
        lower(translate(normalize(value, NFKC), '–—', '  ') COLLATE pg_catalog."und-x-icu"),
        '[[:space:]]+', ' ', 'g'
    )) COLLATE "C"
$$;

CREATE TEMP TABLE rk_catalog (
    kind text NOT NULL, entity_id bigint NOT NULL, division_id int NOT NULL, title text NOT NULL,
    key text COLLATE "C" GENERATED ALWAYS AS (pg_temp.rk_title_key(title)) STORED,
    PRIMARY KEY (kind, entity_id)
) ON COMMIT DROP;

INSERT INTO rk_catalog (kind, entity_id, division_id, title)
SELECT CASE WHEN id % 7 = 0 THEN 'project' ELSE 'task' END, id, (id % 80) + 1,
       format('Pemeriksaan alat operasional %s', id)
FROM generate_series(1, 120000) AS series(id);

INSERT INTO rk_catalog (kind, entity_id, division_id, title) VALUES
  ('project', 120001, 2, 'Ａudit—Mutu Kapal'),
  ('project', 120002, 3, 'Audit   Mutu Kapal'),
  ('task',    120003, 2, 'Migrasi C'),
  ('task',    120004, 2, 'Migrasi C#'),
  ('task',    120005, 2, 'Migrasi C++');
CREATE INDEX rk_catalog_lookup ON rk_catalog (key, kind, division_id, entity_id);

CREATE TEMP TABLE rk_audit (
    kind text NOT NULL, entity_id bigint NOT NULL, division_id int NOT NULL,
    event_id bigint GENERATED ALWAYS AS IDENTITY, changed_at timestamptz NOT NULL, title text,
    key text COLLATE "C" GENERATED ALWAYS AS (pg_temp.rk_title_key(title)) STORED
) ON COMMIT DROP;

INSERT INTO rk_audit (kind, entity_id, division_id, changed_at, title)
SELECT kind, entity_id, division_id, '2026-06-01T00:00:00Z', title FROM rk_catalog;
INSERT INTO rk_audit (kind, entity_id, division_id, changed_at, title) VALUES
  ('project', 120001, 4, '2026-08-01T00:00:00Z', 'Audit Kelautan'),
  ('project', 120002, 3, '2026-08-01T00:00:00Z', 'Audit   Mutu Kapal'),
  ('project', 120002, 3, '2026-08-01T00:00:00Z', NULL);
CREATE INDEX rk_audit_key ON rk_audit (key, kind, division_id, changed_at, entity_id) WHERE key IS NOT NULL;
CREATE INDEX rk_audit_timeline ON rk_audit (kind, entity_id, changed_at DESC, event_id DESC);

CREATE FUNCTION pg_temp.rk_matches_at(needle text, kind_filter text, division_filter int, cutoff timestamptz)
RETURNS TABLE (entity_id bigint)
LANGUAGE sql STABLE AS $$
    SELECT candidate.entity_id
    FROM rk_audit candidate
    WHERE candidate.key = needle COLLATE "C" AND candidate.kind = kind_filter
      AND candidate.division_id = division_filter AND candidate.changed_at <= cutoff
      AND NOT EXISTS (
        SELECT 1 FROM rk_audit later
        WHERE later.kind = candidate.kind AND later.entity_id = candidate.entity_id
          AND later.changed_at <= cutoff
          AND (later.changed_at, later.event_id) > (candidate.changed_at, candidate.event_id)
      )
    LIMIT 2
$$;

-- Prepare all contiguous title hypotheses for a synthetic long turn. Both
-- the observed transcript and catalog use the same PostgreSQL canonicalizer.
WITH speech AS (
    SELECT string_to_array(pg_temp.rk_title_key(
      'Untuk laporan sebelumnya bisa cek status proyek Audit Mutu Kapal sekarang dan bandingkan apakah ada pembaruan terakhir dari unit pengendalian sebelum rapat hari ini, cukup sebutkan fakta yang tercatat saja'
    ), ' ') AS words
)
INSERT INTO rk_utterance_span (key)
SELECT DISTINCT array_to_string(speech.words[a:b], ' ')
FROM speech
CROSS JOIN LATERAL generate_subscripts(speech.words, 1) a
CROSS JOIN LATERAL generate_series(a, cardinality(speech.words)) b;

ANALYZE rk_catalog;
ANALYZE rk_audit;
ANALYZE rk_utterance_span;

DO $$
BEGIN
  IF pg_temp.rk_title_key(E' Ａudit — Mutu\tKapal ') <> pg_temp.rk_title_key('audit mutu kapal') THEN
    RAISE EXCEPTION 'Unequal canonical forms';
  END IF;
  IF (SELECT count(*) FROM rk_catalog WHERE key = pg_temp.rk_title_key('Audit Mutu Kapal')) <> 2
     OR (SELECT min(entity_id) FROM rk_catalog WHERE key = pg_temp.rk_title_key('Audit Mutu Kapal')
         AND division_id = 2 AND kind = 'project') <> 120001 THEN
    RAISE EXCEPTION 'Collision or division scope mismatch';
  END IF;
  IF (SELECT array_agg(entity_id) FROM rk_catalog WHERE key = pg_temp.rk_title_key('Migrasi Ｃ＃'))
      IS DISTINCT FROM ARRAY[120004::bigint] THEN
    RAISE EXCEPTION 'Meaningful symbol was lost';
  END IF;
  IF (SELECT array_agg(entity_id) FROM pg_temp.rk_matches_at('audit mutu kapal', 'project', 2, '2026-07-01T00:00:00Z'))
      IS DISTINCT FROM ARRAY[120001::bigint] THEN
    RAISE EXCEPTION 'Historical title unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.rk_matches_at('audit mutu kapal', 'project', 2, '2026-08-01T00:00:00Z'))
     OR EXISTS (SELECT 1 FROM pg_temp.rk_matches_at('audit mutu kapal', 'project', 3, '2026-08-01T00:00:00Z'))
     OR (SELECT array_agg(entity_id) FROM pg_temp.rk_matches_at('audit kelautan', 'project', 4, '2026-08-01T00:00:00Z'))
        IS DISTINCT FROM ARRAY[120001::bigint] THEN
    RAISE EXCEPTION 'Rename, division move, or deletion did not replace previous evidence';
  END IF;
END $$;

SELECT (SELECT count(*) FROM rk_catalog) AS current_rows, (SELECT count(*) FROM rk_audit) AS audit_rows,
       (SELECT count(*) FROM rk_utterance_span) AS span_probes;

\echo 'Current canonical span lookup'
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT span.key, candidate.entity_id
FROM rk_utterance_span span
CROSS JOIN LATERAL (
    SELECT work.entity_id FROM rk_catalog work WHERE work.key = span.key AND work.kind = 'project'
    LIMIT 2
) candidate;

\echo 'Historical canonical span lookup'
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT span.key, candidate.entity_id
FROM rk_utterance_span span
CROSS JOIN LATERAL pg_temp.rk_matches_at(span.key, 'project', 2, '2026-07-01T00:00:00Z') candidate;

INSERT INTO rk_audit (kind, entity_id, division_id, changed_at, title)
SELECT 'project', id, 2, '2026-06-01T00:00:00Z', 'Pemeriksaan Bulanan'
FROM generate_series(130001, 150000) AS series(id);
INSERT INTO rk_audit (kind, entity_id, division_id, changed_at, title)
SELECT 'project', id, 2, '2026-08-01T00:00:00Z', NULL
FROM generate_series(130001, 150000) AS series(id);
ANALYZE rk_audit;
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.rk_matches_at('pemeriksaan bulanan', 'project', 2, '2026-07-01T00:00:00Z')) <> 2
     OR EXISTS (SELECT 1 FROM pg_temp.rk_matches_at('pemeriksaan bulanan', 'project', 2, '2026-08-01T00:00:00Z')) THEN
    RAISE EXCEPTION 'Dense historical collisions are misclassified';
  END IF;
END $$;
\echo 'Historical collision stress with 20,000 deleted records'
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT entity_id FROM pg_temp.rk_matches_at('pemeriksaan bulanan', 'project', 2, '2026-08-01T00:00:00Z');

ROLLBACK;
