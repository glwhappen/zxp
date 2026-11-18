import { choice, fail, field, requireUser, rows, statement } from './core.js'

export const METHODS = ['learned', 'answer', 'screenshot', 'file']
export const CATEGORIES = ['AI 创作', '编程开发', '效率工具', '产品设计', '其他']
export const THEMES = ['violet', 'peach', 'blue', 'mint']
const VISIBILITY = ['private', 'public']
const maxStages = 50

function bools(item) {
  return { ...item, owned: Boolean(item.owned), joined: Boolean(item.joined) }
}

function enabledMethods(methods) {
  const selected = JSON.parse(methods)
  return METHODS.filter(method => method === 'learned' || selected.includes(method))
}

const courseSelect = `
  SELECT c.id, c.title, c.description, c.category, c.theme, c.visibility, u.name AS author,
    c.owner_id = ? AS owned, c.updated_at, c.moderated_at,
    EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?) AS joined,
    (SELECT COUNT(*) FROM course_stages cs WHERE cs.course_id = c.id) AS stageCount,
    (SELECT COUNT(*) FROM course_stages cs JOIN progress p ON p.stage_id = cs.stage_id
      WHERE cs.course_id = c.id AND p.user_id = ?) AS completedCount,
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
  const list = await rows(statement(db, courseSelect + ` WHERE ${where[scope]}`, id, id, id, ...params))
  return list.map(bools).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
}

export async function courseDetail(db, user, courseId) {
  const id = user?.id ?? ''
  const course = await statement(db, courseSelect + `
    WHERE c.id = ? AND (${publicCourse} OR c.owner_id = ?)
  `, id, id, id, courseId, id).first()
  if (!course) fail(404, '课程不存在或当前账号无权访问。')
  const stages = await rows(statement(db, `
    SELECT s.id, s.title, s.task, s.visibility, s.methods,
      EXISTS(SELECT 1 FROM progress p WHERE p.stage_id = s.id AND p.user_id = ?) AS learned
    FROM course_stages cs JOIN stages s ON s.id = cs.stage_id
    WHERE cs.course_id = ? ORDER BY cs.position
  `, id, courseId))
  return { ...bools(course), stages: stages.map(stage => ({
    ...stage, learned: Boolean(stage.learned), methods: enabledMethods(stage.methods),
  })) }
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

export async function readableStage(db, user, stageId) {
  const id = user?.id ?? ''
  const stage = await statement(db, `
    SELECT s.id, s.title, s.task, s.tutorial, s.visibility, s.methods, s.owner_id = ? AS owned, u.name AS author
    FROM stages s JOIN users u ON u.id = s.owner_id
    WHERE s.id = ? AND (s.visibility = 'public' OR s.owner_id = ?)
  `, id, stageId, id).first()
  if (!stage) fail(404, '关卡不存在或当前账号无权访问。')
  return { ...stage, owned: Boolean(stage.owned), methods: enabledMethods(stage.methods) }
}

export async function stageDetail(db, user, stageId) {
  const stage = await readableStage(db, user, stageId)
  const id = user?.id ?? ''
  const [counts, submissions] = await db.batch([
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
  const { myLearned, ...stats } = counts.results[0]
  return { ...stage, learned: Boolean(myLearned), stats, submissions: submissions.results }
}

async function commit(db, queries, conflict) {
  try {
    await db.batch(queries)
  } catch (error) {
    if (/course_stage_visibility|course_visibility|stage_visibility/.test(error.message)) fail(409, conflict)
    throw error
  }
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
    ...ids.map((stageId, position) => statement(db, 'INSERT INTO course_stages VALUES (?, ?, ?)', id, stageId, position)),
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
  const visibility = choice(data.visibility ?? 'private', VISIBILITY, '关卡可见性')
  const id = stageId ?? crypto.randomUUID()
  const values = [title, task, tutorial, JSON.stringify(selected), visibility, id, owner]
  const write = stageId
    ? statement(db, `UPDATE stages SET title = ?, task = ?, tutorial = ?, methods = ?, visibility = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?`, ...values)
    : statement(db, 'INSERT INTO stages (title, task, tutorial, methods, visibility, id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)', ...values)
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
  await readableStage(db, user, stageId)
  if (typeof learned !== 'boolean') fail(400, 'learned 必须是布尔值。')
  if (learned) {
    await statement(db, 'INSERT OR IGNORE INTO progress (stage_id, user_id) VALUES (?, ?)', stageId, id).run()
    await joinFromStage(db, user, courseId, stageId)
  } else {
    await statement(db, 'DELETE FROM progress WHERE stage_id = ? AND user_id = ?', stageId, id).run()
  }
  return stageDetail(db, user, stageId)
}
