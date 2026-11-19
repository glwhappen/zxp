import { fail, statement } from './core.js'

export const publicCourse = "(c.visibility = 'public' AND c.moderated_at IS NULL)"
export const sharedCourse = actor => `(c.edit_mode = 'shared' AND EXISTS(
  SELECT 1 FROM course_editors ce WHERE ce.course_id = c.id AND ce.user_id = ${actor}))`
export const editableCourse = actor => `(c.owner_id = ${actor} OR (${actor} <> '' AND
  (${sharedCourse(actor)} OR (c.edit_mode = 'public' AND ${publicCourse}))))`
export const readableCourse = actor => `(${publicCourse} OR ${editableCourse(actor)})`

function urlAlias(value, label, reserved) {
  if (value === null || value === '') return null
  if (typeof value !== 'string') fail(400, label + '必须是文本。')
  const alias = value.trim().toLowerCase()
  if (!alias) return null
  if (alias.length < 2 || alias.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) {
    fail(400, '别名须为 2–60 个英文字母、数字或短横线，短横线不能放在开头、末尾或连续使用。')
  }
  if (reserved.includes(alias) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(alias)) {
    fail(400, '这个别名是保留名称，请换一个。')
  }
  return alias
}

export const courseAlias = value => urlAlias(value, '课程别名', ['new'])
export const stageAlias = value => urlAlias(value, '步骤别名', [])

export async function resolveCourseStageId(db, courseId, identifier) {
  const stage = await statement(db, `
    SELECT stage_id FROM course_stages
    WHERE course_id = ?1 AND (stage_id = ?2 OR alias = ?2 COLLATE NOCASE)
  `, courseId, identifier).first()
  if (!stage) fail(404, '这门课程未引用该关卡。')
  return stage.stage_id
}

export async function resolveCourseId(db, identifier) {
  const course = await statement(db, 'SELECT id FROM courses WHERE id = ?1 OR alias = ?1 COLLATE NOCASE', identifier).first()
  if (!course) fail(404, '课程不存在或当前账号无权访问。')
  return course.id
}

export function expectEditor(input, actor) {
  if (input.expectedEditorId !== undefined && input.expectedEditorId !== actor) {
    fail(409, '登录账号已切换，请重新打开课程。')
  }
}

export function expectRevision(value, current) {
  if (value === undefined) return current
  if (!Number.isSafeInteger(value) || value < 0) fail(400, '课程版本号无效。')
  if (value !== current) fail(409, '课程刚被更新。请读取最新版本后再保存。')
  return value
}

// The CHECK constraint aborts the entire batch when its revision or permissions are stale.
export function guardCourse(db, courseId, actor, revision, { ownerOnly = false, advance = true } = {}) {
  const permission = ownerOnly ? 'c.owner_id = ?1' : editableCourse('?1')
  return statement(db, `
    UPDATE courses AS c SET revision = CASE
      WHEN c.revision = ?2 AND ${permission} THEN c.revision + ?3 ELSE -1 END
    WHERE c.id = ?4
  `, actor, revision, Number(advance), courseId)
}

export async function commitCourse(db, queries) {
  try {
    return await db.batch(queries)
  } catch (error) {
    if (/course_stages\.alias|course_stage_alias_conflict/.test(String(error.message))) fail(409, '这个课程里已经有步骤使用该别名，请换一个。')
    if (/courses\.alias|course_alias_conflict/.test(String(error.message))) fail(409, '课程别名已被使用，请换一个。', { code: 'COURSE_ALIAS_TAKEN' })
    if (String(error.message).includes('valid_course_revision')) fail(409, '课程刚被更新。请读取最新版本后再保存。')
    if (String(error.message).includes('prerequisite_cycle')) fail(409, '前置课程不能形成循环。')
    if (String(error.message).includes('prerequisite_visibility')) fail(409, '前置课程的可见性与引用它的课程冲突，请先调整前置设置。')
    if (/course_stage_visibility|course_visibility/.test(error.message)) fail(409, '公开课程需要使用公开关卡，请检查关卡的可见性。')
    throw error
  }
}
