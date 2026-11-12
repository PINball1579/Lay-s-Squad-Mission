ALTER TABLE mission_attempts ADD COLUMN expires_at timestamptz;
UPDATE mission_attempts SET expires_at = started_at + interval '15 minutes' WHERE expires_at IS NULL;
ALTER TABLE mission_attempts ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX mission_attempts_active_expiry_idx ON mission_attempts(assignment_id, expires_at) WHERE status = 'started';

ALTER TABLE mission_completions ADD COLUMN attempt_id uuid REFERENCES mission_attempts(id) ON DELETE RESTRICT;
ALTER TABLE mission_completions ADD COLUMN request_hash bytea;
