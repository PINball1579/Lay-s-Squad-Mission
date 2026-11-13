-- Freeze card team details and acceptance; no LINE user IDs, tokens, or message bodies.
CREATE TABLE line_completion_notifications (
  completion_id uuid PRIMARY KEY REFERENCES mission_completions(id) ON DELETE CASCADE,
  squad_name text NOT NULL,
  completed_count smallint NOT NULL CHECK (completed_count BETWEEN 0 AND 4),
  reward_unlocked boolean NOT NULL,
  accepted_at timestamptz
);
