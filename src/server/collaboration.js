import { choice, fail, field, json, objectBody, requireUser, rows, statement } from './core.js'
import { commitCourse, editableCourse, expectEditor, expectRevision, guardCourse, sharedCourse } from './course-access.js'
import { checkpoint } from './course-history.js'
import {
  assertSubmissionMarkers, courseAtRevision, courseDetail, readableStage, stageDetail, stageInput,
} from './learning.js'
import { insertPrerequisites } from './prerequisites.js'

export const editModes = ['owner', 'shared', 'public']

async function editingCourse(db, user, id, ownerOnly = false) {
  requireUser(user)
  const course = await courseDetail(db, user, id)
  if (ownerOnly ? !course.owned : !course.canEdit) fail(403, ownerOnly ? '只有作者可以管理课程共享。' : '当前账号没有课程编辑权限。')
  return course
}

export async function courseSharing(db, user, id) {
  const course = await editingCourse(db, user, id, true)
  const editors = await rows(statement(db, `
    SELECT u.id, u.name, u.username FROM course_editors e JOIN users u ON u.id = e.user_id
    WHERE e.course_id = ? ORDER BY u.name, u.id
  `, id))
  return { mode: course.edit_mode, visibility: course.visibility, revision: course.revision, editors }
}

export async function searchCourseEditors(db, user, id, value) {
  await editingCourse(db, user, id, true)
  const q = field(value, '用户搜索', 120)
  return rows(statement(db, `
    SELECT u.id, u.name, u.username FROM users u
    WHERE u.id NOT IN (?1, 'workshop-examples')
      AND (u.id = ?2 OR instr(lower(COALESCE(u.username, '')), lower(?2)) > 0 OR instr(lower(u.name), lower(?2)) > 0)
    ORDER BY u.id <> ?2, u.name, u.id LIMIT 20
  `, user.id, q))
}

export async function saveCourseSharing(db, user, id, input) {
  const course = await editingCourse(db, user, id, true)
  expectEditor(input, user.id)
  const revision = expectRevision(input.expectedRevision, course.revision)
  const mode = choice(input.mode, editModes, '共享方式')
  if (!Array.isArray(input.editorIds)) fail(400, '请选择协作者。')
  const ids = [...new Set(input.editorIds.map(value => field(value, '账号 ID', 150)))].filter(value => value !== user.id)
  const rawIds = JSON.stringify(ids)
  const found = await statement(db, `
    SELECT COUNT(*) AS total FROM users WHERE id <> 'workshop-examples' AND id IN (SELECT value FROM json_each(?))
  `, rawIds).first()
  if (found.total !== ids.length) fail(404, '所选协作者中有账号不存在。')
  await commitCourse(db, [
    guardCourse(db, id, user.id, revision, { ownerOnly: true }),
    statement(db, `
      UPDATE courses SET edit_mode = ?1, visibility = CASE WHEN ?1 = 'public' THEN 'public' ELSE visibility END
      WHERE id = ?2
    `, mode, id),
    statement(db, 'DELETE FROM course_editors WHERE course_id = ?', id),
    statement(db, 'INSERT INTO course_editors (course_id, user_id) SELECT ?1, value FROM json_each(?2)', id, rawIds),
    ...(mode === 'public' && course.edit_mode !== 'public'
      ? checkpoint(db, id, revision + 1, user.id, 'published') : []),
  ])
  return courseAtRevision(db, user, id, revision + 1)
}

// A public editor can revisit versions created during public collaboration. A historical
// reference that has since become private is visible only to the owner or invited editors.
const versionAccess = `(c.owner_id = ?1 OR ${sharedCourse('?1')} OR (v.public_history = 1 AND NOT EXISTS (
  SELECT 1 FROM course_version_stages vs JOIN stages s ON s.id = vs.stage_id
  WHERE vs.version_id = v.id AND s.visibility = 'private')))`

export async function courseVersions(db, user, id, before = null) {
  const course = await editingCourse(db, user, id)
  const cursor = before === null ? null : Number(before)
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1)) fail(400, '历史版本位置无效。')
  const versions = await rows(statement(db, `
    SELECT v.id, v.revision, v.title, v.description, v.reason, v.saved_at, u.name AS author
    FROM course_versions v JOIN courses c ON c.id = v.course_id JOIN users u ON u.id = v.saved_by
    WHERE c.id = ?2 AND (?3 IS NULL OR v.revision < ?3) AND ${editableCourse('?1')} AND ${versionAccess}
    ORDER BY v.revision DESC LIMIT 21
  `, user.id, id, cursor))
  const items = versions.slice(0, 20)
  return { revision: course.revision, items, before: versions.length > 20 ? items.at(-1).revision : null }
}

async function versionForEditor(db, user, id, versionId) {
  const snapshot = await statement(db, `
    SELECT v.id, v.revision, v.title, v.description, v.category, v.theme, v.reason, v.saved_at, v.prerequisites
    FROM course_versions v JOIN courses c ON c.id = v.course_id
    WHERE c.id = ?2 AND v.id = ?3 AND ${editableCourse('?1')} AND ${versionAccess}
  `, user.id, id, versionId).first()
  if (!snapshot) fail(404, '历史版本不存在或不可访问。')
  return snapshot
}

export async function inspectCourseVersion(db, user, id, versionId) {
  await editingCourse(db, user, id)
  const snapshot = await versionForEditor(db, user, id, versionId)
  const stages = await rows(statement(db, `
    SELECT stage_id AS id, title FROM course_version_stages WHERE version_id = ? ORDER BY position
  `, versionId))
  const { prerequisites, ...version } = snapshot
  return { ...version, stages, prerequisiteCount: JSON.parse(prerequisites).length }
}

export async function restoreCourseVersion(db, user, id, versionId, input = {}) {
  const course = await editingCourse(db, user, id)
  expectEditor(input, user.id)
  const revision = expectRevision(input.expectedRevision, course.revision)
  const snapshot = await versionForEditor(db, user, id, versionId)
  await commitCourse(db, [
    guardCourse(db, id, user.id, revision),
    ...checkpoint(db, id, revision, user.id, 'before_restore'),
    statement(db, `UPDATE courses SET title = ?, description = ?, category = ?, theme = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      snapshot.title, snapshot.description, snapshot.category, snapshot.theme, id),
    statement(db, 'DELETE FROM course_stages WHERE course_id = ?', id),
    statement(db, `INSERT INTO course_stages (course_id, stage_id, position)
      SELECT ?, stage_id, position FROM course_version_stages WHERE version_id = ?`, id, versionId),
    statement(db, `INSERT INTO course_stage_content (course_id, stage_id, title, task, tutorial)
      SELECT ?, stage_id, title, task, tutorial FROM course_version_stages WHERE version_id = ?`, id, versionId),
    ...(course.owned ? [
      statement(db, 'DELETE FROM course_prerequisites WHERE course_id = ?', id),
      insertPrerequisites(db, id, snapshot.prerequisites),
    ] : []),
    ...checkpoint(db, id, revision + 1, user.id, 'restored'),
  ])
  return courseAtRevision(db, user, id, revision + 1)
}

export async function saveCourseLesson(db, user, id, stageId, input) {
  const course = await editingCourse(db, user, id)
  expectEditor(input, user.id)
  const revision = expectRevision(input.expectedRevision, course.revision)
  const stage = await readableStage(db, user, stageId, id)
  const title = field(input.title, '关卡名称', 100)
  const task = field(input.task, '学习任务', 5000)
  const tutorial = field(input.tutorial ?? '', '教程', 35_000, false)
  const changed = title !== stage.title || task !== stage.task || tutorial !== stage.tutorial
  if (changed) assertSubmissionMarkers(tutorial, stage.methods)
  if (changed || input.checkpoint) {
    const queries = [guardCourse(db, id, user.id, revision, { advance: changed })]
    if (changed) {
      queries.push(...checkpoint(db, id, revision, user.id, 'interval', { periodic: true }))
      queries.push(statement(db, `
        INSERT INTO course_stage_content (course_id, stage_id, title, task, tutorial) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(course_id, stage_id) DO UPDATE SET title = excluded.title, task = excluded.task, tutorial = excluded.tutorial
      `, id, stageId, title, task, tutorial))
      queries.push(statement(db, 'UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', id))
    }
    if (input.checkpoint) queries.push(...checkpoint(db, id, revision + Number(changed), user.id, 'manual'))
    await commitCourse(db, queries)
  }
  const [saved, lesson] = await Promise.all([
    courseAtRevision(db, user, id, revision + Number(changed)), readableStage(db, user, stageId, id),
  ])
  return { course: saved, stage: lesson }
}

export async function addCourseStage(db, user, id, input) {
  const course = await editingCourse(db, user, id)
  expectEditor(input, user.id)
  const revision = expectRevision(input.expectedRevision, course.revision)
  if (course.stages.length >= 50) fail(400, '每门课最多可添加 50 个关卡。')
  const stageId = crypto.randomUUID()
  const stage = stageInput({ ...input, visibility: course.visibility })
  await commitCourse(db, [
    guardCourse(db, id, user.id, revision),
    ...checkpoint(db, id, revision, user.id, 'structure'),
    statement(db, `
      INSERT INTO stages (id, owner_id, title, task, tutorial, methods, required, visibility)
      SELECT ?, owner_id, ?, ?, ?, ?, ?, visibility FROM courses WHERE id = ?
    `, stageId, stage.title, stage.task, stage.tutorial, JSON.stringify(stage.methods),
      JSON.stringify(stage.required), id),
    statement(db, 'INSERT INTO course_stages (course_id, stage_id, position) VALUES (?, ?, ?)', id, stageId, course.stages.length),
    statement(db, 'UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', id),
  ])
  const [saved, lesson] = await Promise.all([
    courseAtRevision(db, user, id, revision + 1), stageDetail(db, user, stageId, id),
  ])
  return { course: saved, stage: lesson }
}

export async function collaborationApi(request, db, user, url, id, action, resource) {
  const method = request.method
  if (action === 'sharing') {
    if (method === 'GET' && !resource) return json(await courseSharing(db, user, id))
    if (method === 'GET' && resource === 'users') return json(await searchCourseEditors(db, user, id, url.searchParams.get('q') ?? ''))
    if (method === 'PUT' && !resource) return json(await saveCourseSharing(db, user, id, await objectBody(request)))
  }
  if (action === 'versions') {
    if (method === 'GET' && !resource) return json(await courseVersions(db, user, id, url.searchParams.get('before')))
    if (method === 'GET' && resource) return json(await inspectCourseVersion(db, user, id, resource))
    if (method === 'POST' && resource) return json(await restoreCourseVersion(db, user, id, resource, await objectBody(request)))
  }
  if (action === 'stages') {
    if (method === 'GET' && resource) {
      await editingCourse(db, user, id)
      return json(await readableStage(db, user, resource, id))
    }
    if (method === 'POST' && !resource) return json(await addCourseStage(db, user, id, await objectBody(request)), 201)
    if (method === 'PUT' && resource) return json(await saveCourseLesson(db, user, id, resource, await objectBody(request)))
  }
  fail(404, '课程协作接口不存在。')
}
