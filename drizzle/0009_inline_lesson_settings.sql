ALTER TABLE course_stage_content ADD COLUMN methods TEXT;
--> statement-breakpoint
ALTER TABLE course_stage_content ADD COLUMN required TEXT;
--> statement-breakpoint
ALTER TABLE course_stage_content ADD COLUMN required_fields TEXT;
--> statement-breakpoint
ALTER TABLE course_version_stages ADD COLUMN methods TEXT;
--> statement-breakpoint
ALTER TABLE course_version_stages ADD COLUMN required TEXT;
--> statement-breakpoint
ALTER TABLE course_version_stages ADD COLUMN required_fields TEXT;
--> statement-breakpoint
ALTER TABLE course_version_stages ADD COLUMN requires TEXT NOT NULL DEFAULT '[]';
