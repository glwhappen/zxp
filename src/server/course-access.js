import { fail, statement } from './core.js'

export const publicCourse = "(c.visibility = 'public' AND c.moderated_at IS NULL)"
export const sharedCourse = actor => `(c.edit_mode = 'shared' AND EXISTS(
  SELECT 1 FROM course_editors ce WHERE ce.course_id = c.id AND ce.user_id = ${actor}))`
export const editableCourse = actor => `(c.owner_id = ${actor} OR (${actor} <> '' AND
  (${sharedCourse(actor)} OR (c.edit_mode = 'public' AND ${publicCourse}))))`
export const readableCourse = actor => `(${publicCourse} OR ${editableCourse(actor)})`

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
    if (String(error.message).includes('valid_course_revision')) fail(409, '课程刚被更新。请读取最新版本后再保存。')
    if (String(error.message).includes('prerequisite_cycle')) fail(409, '前置课程不能形成循环。')
    if (String(error.message).includes('prerequisite_visibility')) fail(409, '前置课程的可见性与引用它的课程冲突，请先调整前置设置。')
    if (/course_stage_visibility|course_visibility/.test(error.message)) fail(409, '公开课程需要使用公开关卡，请检查关卡的可见性。')
    throw error
  }
}
