ALTER TABLE courses ADD COLUMN alias TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX courses_unique_alias ON courses(alias COLLATE NOCASE);
--> statement-breakpoint
CREATE TRIGGER course_alias_insert BEFORE INSERT ON courses
WHEN EXISTS (
  SELECT 1 FROM courses c WHERE c.alias = NEW.id COLLATE NOCASE OR c.id = NEW.alias COLLATE NOCASE
)
BEGIN
  SELECT RAISE(ABORT, 'course_alias_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER course_alias_update BEFORE UPDATE OF alias ON courses
WHEN NEW.alias IS NOT NULL AND EXISTS (
  SELECT 1 FROM courses c WHERE c.id = NEW.alias COLLATE NOCASE AND c.id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'course_alias_conflict');
END;
