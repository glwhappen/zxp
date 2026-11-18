CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT,
  token_hash TEXT UNIQUE
);
--> statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  theme TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  tutorial TEXT NOT NULL,
  methods TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE course_stages (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (course_id, stage_id)
);
--> statement-breakpoint
CREATE INDEX course_stages_by_stage ON course_stages(stage_id);
--> statement-breakpoint
CREATE TABLE enrollments (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, user_id)
);
--> statement-breakpoint
CREATE TABLE progress (
  stage_id TEXT NOT NULL REFERENCES stages(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, user_id)
);
--> statement-breakpoint
CREATE TABLE submissions (
  stage_id TEXT NOT NULL REFERENCES stages(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('answer', 'screenshot', 'file')),
  answer TEXT,
  object_key TEXT UNIQUE,
  filename TEXT,
  mime_type TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stage_id, user_id, kind)
);
--> statement-breakpoint
CREATE TRIGGER valid_course_stage BEFORE INSERT ON course_stages
WHEN EXISTS (
  SELECT 1 FROM courses c, stages s WHERE c.id = NEW.course_id AND s.id = NEW.stage_id
  AND s.visibility = 'private' AND (c.visibility = 'public' OR c.owner_id <> s.owner_id)
)
BEGIN
  SELECT RAISE(ABORT, 'course_stage_visibility');
END;
--> statement-breakpoint
CREATE TRIGGER valid_course_visibility BEFORE UPDATE OF visibility ON courses
WHEN NEW.visibility = 'public' AND EXISTS (
  SELECT 1 FROM course_stages cs JOIN stages s ON s.id = cs.stage_id
  WHERE cs.course_id = NEW.id AND s.visibility = 'private'
)
BEGIN
  SELECT RAISE(ABORT, 'course_visibility');
END;
--> statement-breakpoint
CREATE TRIGGER valid_stage_visibility BEFORE UPDATE OF visibility ON stages
WHEN NEW.visibility = 'private' AND EXISTS (
  SELECT 1 FROM course_stages cs JOIN courses c ON c.id = cs.course_id
  WHERE cs.stage_id = NEW.id AND (c.visibility = 'public' OR c.owner_id <> NEW.owner_id)
)
BEGIN
  SELECT RAISE(ABORT, 'stage_visibility');
END;
