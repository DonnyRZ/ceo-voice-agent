import type { Pool } from 'pg';
import type { CeoFacts } from '../../retrieval/schema.js';
import type { VoiceTranscriptFragment } from '../transcript.js';
import type { VoiceHistoryEntry } from './entry.js';

type HistoryDatabase = Pick<Pool, 'query'>;
type HistoryRow = { sequence: number; recordedAt: Date; entry: VoiceHistoryEntry<CeoFacts> };
type TranscriptLine = Omit<VoiceTranscriptFragment, 'eventId'>;

export async function listVoiceTests(db: HistoryDatabase, limit: number) {
  const { rows } = await db.query(`
    WITH attempts AS (
      SELECT session_id, recorded_at, payload
      FROM app_private.ceo_voice_test_events
      WHERE kind = 'session_attempt'
      ORDER BY recorded_at DESC, session_id
      LIMIT $1
    )
    SELECT attempt.session_id AS "sessionId", attempt.recorded_at AS "startedAt",
      attempt.payload->>'model' AS model, summary.*
    FROM attempts AS attempt
    CROSS JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE kind = 'turn_input')::integer AS "turnCount",
        COUNT(*) FILTER (WHERE kind = 'browser_playback')::integer AS "browserPlaybackSamples",
        MAX(recorded_at) AS "lastEventAt",
        MAX(payload #>> '{metric,reason}') FILTER (
          WHERE kind = 'metric' AND payload #>> '{metric,type}' = 'session'
            AND payload #>> '{metric,action}' = 'closed'
        ) AS "closedBecause"
      FROM app_private.ceo_voice_test_events
      WHERE session_id = attempt.session_id
    ) AS summary
    ORDER BY attempt.recorded_at DESC, attempt.session_id
  `, [limit]);
  return rows;
}

export async function readVoiceTest(db: HistoryDatabase, sessionId: string) {
  const { rows } = await db.query<HistoryRow>(`
    SELECT sequence, recorded_at AS "recordedAt", payload AS entry
    FROM app_private.ceo_voice_test_events
    WHERE session_id = $1
    ORDER BY sequence
  `, [sessionId]);
  if (!rows.length) return;

  const fragments: VoiceTranscriptFragment[] = [];
  const transcriptEvents: Array<Omit<HistoryRow, 'entry'> & { fragment: VoiceTranscriptFragment }> = [];
  const events: HistoryRow[] = [];
  for (const row of rows) {
    if (row.entry.type === 'transcript') {
      fragments.push(row.entry.fragment);
      transcriptEvents.push({ sequence: row.sequence, recordedAt: row.recordedAt, fragment: row.entry.fragment });
    } else events.push(row);
  }
  return {
    sessionId,
    hasSequenceGaps: rows.some((row, index) => row.sequence !== index + 1),
    transcript: groupTranscript(fragments),
    transcriptEvents,
    events,
  };
}

function groupTranscript(fragments: VoiceTranscriptFragment[]) {
  const lines: TranscriptLine[] = [];
  for (const { role, text, startMs, endMs } of fragments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const previous = lines.at(-1);
    if (previous?.role === role && startMs - previous.endMs <= 1_500) {
      previous.text += text;
      previous.endMs = Math.max(previous.endMs, endMs);
    } else {
      lines.push({ role, text, startMs, endMs });
    }
  }
  return lines.map((line) => ({ ...line, text: line.text.trim() })).filter((line) => line.text);
}
