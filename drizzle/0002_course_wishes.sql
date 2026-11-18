CREATE TABLE wishes (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  approach TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX wishes_recent ON wishes(updated_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX wishes_status_recent ON wishes(status, updated_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE wish_replies (
  id INTEGER PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX wish_replies_by_wish ON wish_replies(wish_id, id DESC);
--> statement-breakpoint
CREATE TABLE wish_courses (
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  linked_by TEXT NOT NULL REFERENCES users(id),
  reaction TEXT CHECK(reaction IN ('up', 'down')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wish_id, course_id)
);
--> statement-breakpoint
CREATE TRIGGER wish_reply_activity AFTER INSERT ON wish_replies
BEGIN
  UPDATE wishes SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.wish_id;
END;
--> statement-breakpoint
CREATE TRIGGER wish_course_activity AFTER INSERT ON wish_courses
BEGIN
  UPDATE wishes SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.wish_id;
END;
--> statement-breakpoint
CREATE TRIGGER wish_reaction_activity AFTER UPDATE OF reaction ON wish_courses
WHEN OLD.reaction IS NOT NEW.reaction
BEGIN
  UPDATE wishes SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.wish_id;
END;
