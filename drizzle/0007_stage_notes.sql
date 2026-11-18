CREATE TABLE stage_notes (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES stage_notes(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX stage_notes_by_stage ON stage_notes(stage_id, parent_id, created_at);
