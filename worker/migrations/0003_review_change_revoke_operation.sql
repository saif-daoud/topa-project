CREATE TABLE review_changes_next (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  component TEXT NOT NULL,
  path_json TEXT NOT NULL,
  target_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('add','replace','remove','restore','revoke')),
  old_value_json TEXT,
  new_value_json TEXT,
  comment TEXT,
  revoked_change_id TEXT,
  timestamp_utc TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO review_changes_next (
  id,
  session_id,
  participant_id,
  component,
  path_json,
  target_id,
  operation,
  old_value_json,
  new_value_json,
  comment,
  revoked_change_id,
  timestamp_utc,
  received_at
)
SELECT
  id,
  session_id,
  participant_id,
  component,
  path_json,
  target_id,
  operation,
  old_value_json,
  new_value_json,
  comment,
  revoked_change_id,
  timestamp_utc,
  received_at
FROM review_changes;

DROP TABLE review_changes;
ALTER TABLE review_changes_next RENAME TO review_changes;

CREATE INDEX IF NOT EXISTS idx_review_changes_session ON review_changes(session_id, timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_review_changes_component ON review_changes(component);
