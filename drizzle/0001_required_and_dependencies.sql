ALTER TABLE stages ADD COLUMN required TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE course_stages ADD COLUMN requires TEXT NOT NULL DEFAULT '[]';
