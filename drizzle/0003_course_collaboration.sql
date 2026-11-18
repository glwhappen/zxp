ALTER TABLE courses ADD COLUMN edit_mode TEXT NOT NULL DEFAULT 'owner' CHECK (edit_mode IN ('owner', 'shared', 'public'));
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT valid_course_revision CHECK (revision >= 0);
--> statement-breakpoint
CREATE TABLE course_editors (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, user_id)
);
--> statement-breakpoint
CREATE INDEX course_editors_by_user ON course_editors(user_id, course_id);
--> statement-breakpoint
CREATE TABLE course_stage_content (
  course_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  tutorial TEXT NOT NULL,
  PRIMARY KEY (course_id, stage_id),
  FOREIGN KEY (course_id, stage_id) REFERENCES course_stages(course_id, stage_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE course_versions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  saved_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  public_history INTEGER NOT NULL CHECK (public_history IN (0, 1)),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  theme TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (course_id, revision)
);
--> statement-breakpoint
CREATE TABLE course_version_stages (
  version_id TEXT NOT NULL REFERENCES course_versions(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  tutorial TEXT NOT NULL,
  PRIMARY KEY (version_id, stage_id)
);
