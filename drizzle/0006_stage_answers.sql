CREATE TABLE stage_answers (
  stage_id TEXT NOT NULL REFERENCES stages(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stage_id, user_id, field)
);
