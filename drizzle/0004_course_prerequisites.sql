CREATE TABLE course_prerequisites (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  prerequisite_id TEXT NOT NULL REFERENCES courses(id),
  mode TEXT NOT NULL CHECK (mode IN ('required', 'recommended')),
  position INTEGER NOT NULL,
  PRIMARY KEY (course_id, prerequisite_id)
);
--> statement-breakpoint
CREATE INDEX course_prerequisites_target ON course_prerequisites(prerequisite_id, course_id);
--> statement-breakpoint
ALTER TABLE course_versions ADD COLUMN prerequisites TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TRIGGER valid_prerequisite_cycle BEFORE INSERT ON course_prerequisites
WHEN EXISTS (
  WITH RECURSIVE reachable(id) AS (
    SELECT NEW.prerequisite_id
    UNION
    SELECT p.prerequisite_id FROM course_prerequisites p JOIN reachable r ON p.course_id = r.id
  ) SELECT 1 FROM reachable WHERE id = NEW.course_id
)
BEGIN
  SELECT RAISE(ABORT, 'prerequisite_cycle');
END;
--> statement-breakpoint
CREATE TRIGGER valid_prerequisite_visibility BEFORE INSERT ON course_prerequisites
WHEN EXISTS (
  SELECT 1 FROM courses c JOIN courses p ON p.id = NEW.prerequisite_id
  WHERE c.id = NEW.course_id AND p.visibility = 'private'
    AND (c.visibility = 'public' OR c.owner_id <> p.owner_id)
)
BEGIN
  SELECT RAISE(ABORT, 'prerequisite_visibility');
END;
--> statement-breakpoint
CREATE TRIGGER valid_prerequisite_publish BEFORE UPDATE OF visibility ON courses
WHEN (
  NEW.visibility = 'public' AND EXISTS (
    SELECT 1 FROM course_prerequisites r JOIN courses p ON p.id = r.prerequisite_id
    WHERE r.course_id = NEW.id AND p.visibility = 'private'
  )
) OR (
  NEW.visibility = 'private' AND EXISTS (
    SELECT 1 FROM course_prerequisites r JOIN courses c ON c.id = r.course_id
    WHERE r.prerequisite_id = NEW.id AND (c.visibility = 'public' OR c.owner_id <> NEW.owner_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'prerequisite_visibility');
END;
