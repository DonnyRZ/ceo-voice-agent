-- Up Migration
CREATE TABLE app_private.ceo_voice_test_events (
    session_id uuid NOT NULL,
    sequence integer NOT NULL CHECK (sequence > 0),
    recorded_at timestamptz NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (session_id, sequence)
);

CREATE INDEX ceo_voice_test_attempts_idx
    ON app_private.ceo_voice_test_events (recorded_at DESC, session_id)
    WHERE kind = 'session_attempt';

ALTER TABLE app_private.ceo_voice_test_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ceo_voice_test_append ON app_private.ceo_voice_test_events
    FOR INSERT WITH CHECK (true);

-- Down Migration
DROP TABLE app_private.ceo_voice_test_events;
