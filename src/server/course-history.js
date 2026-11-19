import { statement } from './core.js'

export function checkpoint(db, courseId, revision, actor, reason, { periodic = false } = {}) {
  const versionId = crypto.randomUUID()
  return [
    statement(db, `
      INSERT OR IGNORE INTO course_versions (id, course_id, revision, saved_by, reason, public_history, title, description, category, theme, prerequisites)
      SELECT ?1, c.id, ?3, ?4, ?5, c.edit_mode = 'public' AND c.visibility = 'public' AND c.moderated_at IS NULL,
        c.title, c.description, c.category, c.theme,
        (SELECT json_group_array(json_object('courseId', p.prerequisite_id, 'mode', p.mode) ORDER BY p.position)
         FROM course_prerequisites p WHERE p.course_id = c.id)
      FROM courses c
      WHERE c.id = ?2 AND (?6 = 0 OR NOT EXISTS (
        SELECT 1 FROM course_versions v WHERE v.course_id = c.id AND v.saved_at >= datetime('now', '-10 minutes')
      ))
    `, versionId, courseId, revision, actor, reason, Number(periodic)),
    statement(db, `
      INSERT INTO course_version_stages (version_id, stage_id, position, title, task, tutorial, methods, required, required_fields, requires)
      SELECT ?1, cs.stage_id, cs.position, COALESCE(l.title, s.title), COALESCE(l.task, s.task), COALESCE(l.tutorial, s.tutorial),
        COALESCE(l.methods, s.methods), COALESCE(l.required, s.required), COALESCE(l.required_fields, '[]'), cs.requires
      FROM course_stages cs JOIN stages s ON s.id = cs.stage_id
      LEFT JOIN course_stage_content l ON l.course_id = cs.course_id AND l.stage_id = cs.stage_id
      WHERE cs.course_id = ?2 AND EXISTS (SELECT 1 FROM course_versions WHERE id = ?1)
    `, versionId, courseId),
  ]
}
