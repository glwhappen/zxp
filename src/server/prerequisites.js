import { choice, fail, field, rows, statement } from './core.js'
import { publicCourse, readableCourse } from './course-access.js'

export const prerequisiteModes = ['required', 'recommended']
export const prerequisiteLockMessage = '请先完成必修的前置课程。'

export function prerequisiteInput(value) {
  if (!Array.isArray(value) || value.length > 12) fail(400, '一门课最多可以添加 12 门前置课程。')
  const prerequisites = value.map(item => ({
    courseId: field(item?.courseId, '前置课程 ID', 100),
    mode: choice(item?.mode, prerequisiteModes, '前置课程类型'),
  }))
  if (new Set(prerequisites.map(item => item.courseId)).size !== prerequisites.length) {
    fail(400, '每门前置课程只能添加一次。')
  }
  return prerequisites
}

export function prerequisiteQuery(db, user, courseId) {
  return statement(db, `
    WITH RECURSIVE links(root, target) AS (
      SELECT prerequisite_id, prerequisite_id FROM course_prerequisites WHERE course_id = ?2
      UNION
      SELECT links.root, p.prerequisite_id FROM links
      JOIN course_prerequisites p ON p.course_id = links.target AND p.mode = 'required'
    ),
    pending AS (
      SELECT DISTINCT links.root FROM links JOIN courses c ON c.id = links.target
      WHERE NOT ${readableCourse('?1')} OR EXISTS (
        SELECT 1 FROM course_stages cs JOIN stages s ON s.id = cs.stage_id
        LEFT JOIN course_stage_content l ON l.course_id = cs.course_id AND l.stage_id = cs.stage_id
        WHERE cs.course_id = c.id AND (NOT EXISTS (
          SELECT 1 FROM progress p WHERE p.stage_id = cs.stage_id AND p.user_id = ?1
        ) OR EXISTS (
          SELECT 1 FROM json_each(COALESCE(l.required, s.required)) r WHERE NOT EXISTS (
            SELECT 1 FROM submissions sub WHERE sub.stage_id = s.id AND sub.user_id = ?1 AND sub.kind = r.value
          )
        ) OR EXISTS (
          SELECT 1 FROM json_each(COALESCE(l.required_fields, '[]')) r WHERE NOT EXISTS (
            SELECT 1 FROM stage_answers a WHERE a.stage_id = s.id AND a.user_id = ?1 AND a.field = r.value AND trim(a.value) <> ''
          )
        ))
      )
    )
    SELECT r.prerequisite_id AS courseId, r.mode,
      CASE WHEN ${readableCourse('?1')} THEN c.title END AS title,
      CASE WHEN ${readableCourse('?1')} THEN c.visibility END AS visibility,
      p.root IS NULL AS completed
    FROM course_prerequisites r JOIN courses c ON c.id = r.prerequisite_id
    LEFT JOIN pending p ON p.root = r.prerequisite_id
    WHERE r.course_id = ?2 ORDER BY r.position
  `, user?.id ?? '', courseId)
}

export function lockedByPrerequisites(items) {
  return items.some(item => item.mode === 'required' && !item.completed)
}

export async function prerequisiteChoices(db, user, courseId) {
  return rows(statement(db, `
    SELECT c.id, c.title, c.visibility FROM courses c
    WHERE c.id <> ?2 AND (${publicCourse} OR c.owner_id = ?1)
    ORDER BY c.owner_id <> ?1, c.title, c.id
  `, user.id, courseId ?? ''))
}

export async function validatePrerequisites(db, actor, items) {
  if (!items.length) return
  const ids = JSON.stringify(items.map(item => item.courseId))
  const found = await statement(db, `
    SELECT COUNT(*) AS total FROM courses c
    WHERE c.id IN (SELECT value FROM json_each(?2)) AND (${publicCourse} OR c.owner_id = ?1)
  `, actor, ids).first()
  if (found.total !== items.length) fail(404, '所选前置课程中有课程不可访问。')
}

export function insertPrerequisites(db, id, json) {
  return statement(db, `
    INSERT INTO course_prerequisites (course_id, prerequisite_id, mode, position)
    SELECT ?1, value ->> '$.courseId', value ->> '$.mode', key FROM json_each(?2)
  `, id, json)
}

export async function requireStageLearning(db, user, stageId, courseId) {
  if (courseId) {
    if (lockedByPrerequisites(await rows(prerequisiteQuery(db, user, courseId)))) fail(403, prerequisiteLockMessage)
    return
  }
  // Keep old direct links working if at least one accessible placement is unlocked.
  const attached = await rows(statement(db, `
    SELECT c.id, ${readableCourse('?1')} AS readable,
      EXISTS(SELECT 1 FROM course_prerequisites p WHERE p.course_id = c.id AND p.mode = 'required') AS gated
    FROM courses c JOIN course_stages cs ON cs.course_id = c.id
    WHERE cs.stage_id = ?2
  `, user?.id ?? '', stageId))
  if (!attached.length || attached.some(course => course.readable && !course.gated)) return
  for (const course of attached) {
    if (course.readable && !lockedByPrerequisites(await rows(prerequisiteQuery(db, user, course.id)))) return
  }
  if (attached.some(course => course.readable)) fail(403, prerequisiteLockMessage)
  fail(404, '关卡不存在或当前账号无权访问。')
}
