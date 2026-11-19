ALTER TABLE course_stages ADD COLUMN alias TEXT;
--> statement-breakpoint
ALTER TABLE course_version_stages ADD COLUMN alias TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX course_stages_unique_alias ON course_stages(course_id, alias COLLATE NOCASE);
--> statement-breakpoint
CREATE TRIGGER course_stage_alias_insert BEFORE INSERT ON course_stages
WHEN EXISTS (
  SELECT 1 FROM course_stages cs WHERE cs.course_id = NEW.course_id AND cs.stage_id <> NEW.stage_id
  AND (cs.alias = NEW.stage_id COLLATE NOCASE OR cs.stage_id = NEW.alias COLLATE NOCASE)
)
BEGIN
  SELECT RAISE(ABORT, 'course_stage_alias_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER course_stage_alias_update BEFORE UPDATE OF alias ON course_stages
WHEN NEW.alias IS NOT NULL AND EXISTS (
  SELECT 1 FROM course_stages cs WHERE cs.course_id = NEW.course_id
    AND cs.stage_id = NEW.alias COLLATE NOCASE AND cs.stage_id <> NEW.stage_id
)
BEGIN
  SELECT RAISE(ABORT, 'course_stage_alias_conflict');
END;
