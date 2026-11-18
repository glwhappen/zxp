import {
  enabledMethods, KINDS, kindLabels, METHODS, missingRequired, parseList, requiredMethods,
} from '../shared.js'
import { choice, fail, field, requireUser, rows, statement } from './core.js'

export const CATEGORIES = ['AI 创作', '编程开发', '效率工具', '产品设计', '其他']
export const THEMES = ['violet', 'peach', 'blue', 'mint']
const VISIBILITY = ['private', 'public']
const maxStages = 50

function bools(item) {
  return { ...item, owned: Boolean(item.owned), joined: Boolean(item.joined) }
}

// 依次绑定 4 个当前账号 ID：是否自有、是否加入、已学会、必填提交。
// completedCount 只统计「标记学会且必填项都已提交」的关卡。
const courseSelect = `
  SELECT c.id, c.title, c.description, c.category, c.theme, c.visibility, u.name AS author,
    c.owner_id = ? AS owned, c.updated_at, c.moderated_at,
    EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?) AS joined,
    (SELECT COUNT(*) FROM course_stages cs WHERE cs.course_id = c.id) AS stageCount,
    (SELECT COUNT(*) FROM course_stages cs JOIN progress p ON p.stage_id = cs.stage_id
      JOIN stages s ON s.id = cs.stage_id
      WHERE cs.course_id = c.id AND p.user_id = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(s.required) r WHERE NOT EXISTS (
        SELECT 1 FROM submissions sub WHERE sub.stage_id = cs.stage_id AND sub.user_id = ? AND sub.kind = r.value)))
      AS completedCount,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learnerCount
  FROM courses c JOIN users u ON u.id = c.owner_id
`

const publicCourse = "(c.visibility = 'public' AND c.moderated_at IS NULL)"

export async function listCourses(db, user, scope = 'public') {
  const id = user?.id ?? ''
  const where = {
    public: `${publicCourse} AND ? IS NOT NULL`,
    owned: 'c.owner_id = ?',
    joined: `(${publicCourse} OR c.owner_id = ?) AND EXISTS (SELECT 1 FROM enrollments WHERE course_id = c.id AND user_id = ?)`,
  }
  if (!Object.hasOwn(where, scope)) fail(400, '课程范围无效。')
  const params = scope === 'joined' ? [id, id] : [id]
  const list = await rows(statement(db, courseSelect + ` WHERE ${where[scope]}`, id, id, id, id, ...params))
  return list.map(bools).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
}

export async function courseDetail(db, user, courseId) {
  const id = user?.id ?? ''
  const [courseResult, stageResult] = await db.batch([
    statement(db, courseSelect + ` WHERE c.id = ? AND (${publicCourse} OR c.owner_id = ?)`, id, id, id, id, courseId, id),
    statement(db, `
      SELECT s.id, s.title, s.task, s.visibility, s.methods, s.required, cs.requires,
        EXISTS(SELECT 1 FROM progress p WHERE p.stage_id = s.id AND p.user_id = ?) AS marked,
        (SELECT json_group_array(kind) FROM submissions sub WHERE sub.stage_id = s.id AND sub.user_id = ?) AS submitted
      FROM course_stages cs JOIN stages s ON s.id = cs.stage_id JOIN courses c ON c.id = cs.course_id
      WHERE cs.course_id = ? AND (${publicCourse} OR c.owner_id = ?) ORDER BY cs.position
    `, id, id, courseId, id),
  ])
  const record = courseResult.results[0]
  if (!record) fail(404, '课程不存在或当前账号无权访问。')
  const course = bools(record)
  const entries = stageResult.results
  const known = new Set(entries.map(entry => entry.id))
  const stages = entries.map(entry => {
    const methods = enabledMethods(entry.methods)
    const required = requiredMethods(entry.required, methods)
    const missing = missingRequired(required, parseList(entry.submitted))
    return {
      id: entry.id,
      title: entry.title,
      task: entry.task,
      visibility: entry.visibility,
      methods,
      required,
      missing,
      requires: parseList(entry.requires).filter(dependency => known.has(dependency)),
      learned: Boolean(entry.marked) && !missing.length,
    }
  })
  const byId = new Map(stages.map(stage => [stage.id, stage]))
  // 作者可以预览全部关卡；学习者要先学会前置关卡，自己已学会的关卡始终可回看。
  const outline = stages.map(stage => ({ ...stage,
    locked: !course.owned && !stage.learned
      && stage.requires.some(dependency => !byId.get(dependency)?.learned) }))
  return { ...course, stages: outline }
}

export async function listStages(db, user, scope = 'available') {
  const id = user?.id ?? ''
  choice(scope, ['available', 'owned'], '关卡范围')
  const where = scope === 'owned' ? 's.owner_id = ?' : "(s.owner_id = ? OR s.visibility = 'public')"
  const list = await rows(statement(db, `
    SELECT s.id, s.title, s.task, s.visibility, s.owner_id = ? AS owned, u.name AS author
    FROM stages s JOIN users u ON u.id = s.owner_id
    WHERE ${where} ORDER BY s.updated_at DESC, s.title
  `, id, id))
  return list.map(stage => ({ ...stage, owned: Boolean(stage.owned) }))
}

function stageQuery(db, user, stageId) {
  const id = user?.id ?? ''
  return statement(db, `
    SELECT s.id, s.title, s.task, s.tutorial, s.visibility, s.methods, s.required,
      s.owner_id = ? AS owned, u.name AS author
    FROM stages s JOIN users u ON u.id = s.owner_id
    WHERE s.id = ? AND (s.visibility = 'public' OR s.owner_id = ?)
  `, id, stageId, id)
}

function stageData(stage) {
  if (!stage) fail(404, '关卡不存在或当前账号无权访问。')
  const methods = enabledMethods(stage.methods)
  return { ...stage, owned: Boolean(stage.owned), methods, required: requiredMethods(stage.required, methods) }
}

export async function readableStage(db, user, stageId) {
  return stageData(await stageQuery(db, user, stageId).first())
}

export async function stageDetail(db, user, stageId) {
  const id = user?.id ?? ''
  const [stageResult, counts, submissions] = await db.batch([
    stageQuery(db, user, stageId),
    statement(db, `
      SELECT
        (SELECT COUNT(*) FROM progress WHERE stage_id = ?1) AS learned,
        EXISTS(SELECT 1 FROM progress WHERE stage_id = ?1 AND user_id = ?2) AS myLearned,
        COUNT(CASE WHEN kind = 'answer' THEN 1 END) AS answer,
        COUNT(CASE WHEN kind = 'screenshot' THEN 1 END) AS screenshot,
        COUNT(CASE WHEN kind = 'file' THEN 1 END) AS file,
        (SELECT COUNT(*) FROM (
          SELECT user_id FROM progress WHERE stage_id = ?1
          UNION SELECT user_id FROM submissions WHERE stage_id = ?1
        )) AS participants
      FROM submissions WHERE stage_id = ?1
    `, stageId, id),
    statement(db, `
      SELECT kind, answer, filename, updated_at FROM submissions WHERE stage_id = ? AND user_id = ?
    `, stageId, id),
  ])
  const stage = stageData(stageResult.results[0])
  const { myLearned, ...stats } = counts.results[0]
  const missing = missingRequired(stage.required, submissions.results.map(entry => entry.kind))
  return { ...stage, learned: Boolean(myLearned) && !missing.length, stats, submissions: submissions.results, missing }
}

async function commit(db, queries, conflict) {
  try {
    await db.batch(queries)
  } catch (error) {
    if (/course_stage_visibility|course_visibility|stage_visibility/.test(error.message)) fail(409, conflict)
    throw error
  }
}

// 依赖只能指向本课程中排在当前关卡之前的关卡，既是顺序约束，也避免成环。
function stageRequires(data, ids) {
  const value = data.requires ?? {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '关卡依赖格式无效。')
  const position = new Map(ids.map((stageId, index) => [stageId, index]))
  const requires = new Map()
  for (const [stageId, list] of Object.entries(value)) {
    if (!position.has(stageId)) continue
    if (!Array.isArray(list) || new Set(list).size !== list.length) fail(400, '关卡依赖格式无效。')
    const kept = []
    for (const dependency of list) {
      field(dependency, '前置关卡 ID', 100)
      if (dependency === stageId) fail(400, '关卡不能依赖自己。')
      if (!position.has(dependency)) continue
      if (position.get(dependency) > position.get(stageId)) fail(400, '前置关卡必须排在当前关卡之前。')
      kept.push(dependency)
    }
    if (kept.length) requires.set(stageId, kept)
  }
  return requires
}

export async function saveCourse(db, user, data, courseId) {
  const owner = requireUser(user)
  if (courseId && !(await courseDetail(db, user, courseId)).owned) fail(403, '只有课程作者可以编辑课程。')
  const title = field(data.title, '课程名称', 100)
  const description = field(data.description ?? '', '课程介绍', 1200, false)
  const category = choice(data.category ?? '其他', CATEGORIES, '课程分类')
  const theme = choice(data.theme ?? 'violet', THEMES, '课程主题色')
  const visibility = choice(data.visibility ?? 'private', VISIBILITY, '课程可见性')
  const ids = data.stageIds ?? []
  if (!Array.isArray(ids) || ids.length > maxStages || new Set(ids).size !== ids.length) {
    fail(400, `每门课最多引用 ${maxStages} 个关卡，关卡不能重复。`)
  }
  for (const id of ids) field(id, '关卡 ID', 100)
  const requires = stageRequires(data, ids)
  if (ids.length) {
    const accessible = await rows(statement(db, `
      SELECT id, visibility FROM stages WHERE (owner_id = ? OR visibility = 'public')
      AND id IN (${ids.map(() => '?').join(', ')})
    `, owner, ...ids))
    if (accessible.length !== ids.length) fail(404, '选择中包含无法访问的关卡。')
    if (visibility === 'public' && accessible.some(stage => stage.visibility !== 'public')) {
      fail(409, '发布课程前，请先公开选中的关卡，或移除私有的关卡。')
    }
  }
  const id = courseId ?? crypto.randomUUID()
  const write = courseId
    ? statement(db, `UPDATE courses SET title = ?, description = ?, category = ?, theme = ?, visibility = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?`, title, description, category, theme, visibility, id, owner)
    : statement(db, `INSERT INTO courses (title, description, category, theme, visibility, id, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, title, description, category, theme, visibility, id, owner)
  await commit(db, [
    statement(db, 'DELETE FROM course_stages WHERE course_id = ?', id),
    write,
    ...ids.map((stageId, position) => statement(db,
      'INSERT INTO course_stages (course_id, stage_id, position, requires) VALUES (?, ?, ?, ?)',
      id, stageId, position, JSON.stringify(requires.get(stageId) ?? []))),
  ], '课程和关卡的公开状态发生变化，请刷新后重试。')
  return courseDetail(db, user, id)
}

export async function saveStage(db, user, data, stageId) {
  const owner = requireUser(user)
  if (stageId && !(await readableStage(db, user, stageId)).owned) fail(403, '只有关卡作者可以编辑关卡。')
  const title = field(data.title, '关卡名称', 100)
  const task = field(data.task, '学习任务', 5000)
  const tutorial = field(data.tutorial ?? '', '教程', 35_000, false)
  const methods = data.methods ?? []
  if (!Array.isArray(methods) || new Set(methods).size !== methods.length
      || methods.some(method => !METHODS.includes(method))) fail(400, '请选择有效且不重复的提交方式。')
  const selected = METHODS.filter(method => method === 'learned' || methods.includes(method))
  const required = data.required ?? []
  if (!Array.isArray(required) || new Set(required).size !== required.length
      || required.some(kind => !KINDS.includes(kind))) fail(400, '请选择有效且不重复的必填提交方式。')
  if (required.some(kind => !selected.includes(kind))) fail(400, '必填项需要同时开启对应的提交方式。')
  const mustSubmit = KINDS.filter(kind => required.includes(kind))
  const visibility = choice(data.visibility ?? 'private', VISIBILITY, '关卡可见性')
  const id = stageId ?? crypto.randomUUID()
  const values = [title, task, tutorial, JSON.stringify(selected), JSON.stringify(mustSubmit), visibility, id, owner]
  const write = stageId
    ? statement(db, `UPDATE stages SET title = ?, task = ?, tutorial = ?, methods = ?, required = ?, visibility = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?`, ...values)
    : statement(db, `INSERT INTO stages (title, task, tutorial, methods, required, visibility, id, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ...values)
  await commit(db, [write], '该关卡正在被公开课程或其他作者引用，请先解除相关引用。')
  return stageDetail(db, user, id)
}

export async function joinCourse(db, user, courseId) {
  const id = requireUser(user)
  await courseDetail(db, user, courseId)
  await statement(db, `
    INSERT OR IGNORE INTO enrollments (course_id, user_id)
    SELECT c.id, ? FROM courses c WHERE c.id = ? AND (${publicCourse} OR c.owner_id = ?)
  `, id, courseId, id).run()
  return courseDetail(db, user, courseId)
}

export async function joinFromStage(db, user, courseId, stageId) {
  if (typeof courseId !== 'string' || !courseId || courseId.length > 100) return
  await statement(db, `
    INSERT OR IGNORE INTO enrollments (course_id, user_id)
    SELECT c.id, ?1 FROM courses c JOIN course_stages cs ON cs.course_id = c.id
    WHERE c.id = ?2 AND cs.stage_id = ?3 AND (${publicCourse} OR c.owner_id = ?1)
  `, user.id, courseId, stageId).run()
}

export async function markLearned(db, user, stageId, learned, courseId) {
  const id = requireUser(user)
  const stage = await readableStage(db, user, stageId)
  if (typeof learned !== 'boolean') fail(400, 'learned 必须是布尔值。')
  if (learned) {
    const submitted = await rows(statement(db,
      'SELECT kind FROM submissions WHERE stage_id = ? AND user_id = ?', stageId, id))
    const missing = missingRequired(stage.required, submitted.map(entry => entry.kind))
    if (missing.length) fail(409, `请先完成必填提交：${kindLabels(missing)}。`)
    await statement(db, 'INSERT OR IGNORE INTO progress (stage_id, user_id) VALUES (?, ?)', stageId, id).run()
    await joinFromStage(db, user, courseId, stageId)
  } else {
    await statement(db, 'DELETE FROM progress WHERE stage_id = ? AND user_id = ?', stageId, id).run()
  }
  return stageDetail(db, user, stageId)
}
