import {
  enabledMethods, KINDS, kindLabels, METHODS, missingRequired, parseList, requiredMethods,
} from '../shared.js'
import { choice, fail, field, requireUser, rows, statement } from './core.js'
import { commitCourse, editableCourse, expectEditor, expectRevision, guardCourse, publicCourse, readableCourse, sharedCourse } from './course-access.js'
import { checkpoint } from './course-history.js'
import {
  insertPrerequisites, lockedByPrerequisites, prerequisiteInput, prerequisiteLockMessage, prerequisiteQuery,
  requireStageLearning, validatePrerequisites,
} from './prerequisites.js'

export { publicCourse } from './course-access.js'

export const CATEGORIES = ['AI 创作', '编程开发', '效率工具', '产品设计', '其他']
export const THEMES = ['violet', 'peach', 'blue', 'mint']
const VISIBILITY = ['private', 'public']
const maxStages = 50

function bools(item) {
  return { ...item, owned: Boolean(item.owned), canEdit: Boolean(item.canEdit), joined: Boolean(item.joined) }
}

const courseSelect = `
  SELECT c.id, c.title, c.description, c.category, c.theme, c.visibility, u.name AS author,
    c.owner_id = ?1 AS owned, ${editableCourse('?1')} AS canEdit, c.edit_mode, c.revision, c.updated_at, c.moderated_at,
    EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?1) AS joined,
    (SELECT COUNT(*) FROM course_stages cs WHERE cs.course_id = c.id) AS stageCount,
    (SELECT COUNT(*) FROM course_stages cs JOIN progress p ON p.stage_id = cs.stage_id
      JOIN stages s ON s.id = cs.stage_id
      WHERE cs.course_id = c.id AND p.user_id = ?1
      AND NOT EXISTS (SELECT 1 FROM json_each(s.required) r WHERE NOT EXISTS (
        SELECT 1 FROM submissions sub WHERE sub.stage_id = cs.stage_id AND sub.user_id = ?1 AND sub.kind = r.value)))
      AS completedCount,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learnerCount
  FROM courses c JOIN users u ON u.id = c.owner_id
`

export async function listCourses(db, user, scope = 'public') {
  const id = user?.id ?? ''
  const where = {
    public: publicCourse,
    owned: 'c.owner_id = ?1',
    managed: `(c.owner_id = ?1 OR ${sharedCourse('?1')})`,
    joined: `${readableCourse('?1')} AND EXISTS (SELECT 1 FROM enrollments WHERE course_id = c.id AND user_id = ?1)`,
  }
  if (!Object.hasOwn(where, scope)) fail(400, '课程范围无效。')
  const list = await rows(statement(db, courseSelect + ` WHERE ${where[scope]}`, id))
  return list.map(bools).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
}

export async function courseDetail(db, user, courseId) {
  const id = user?.id ?? ''
  const [courseResult, stageResult, requirementsResult] = await db.batch([
    statement(db, courseSelect + ` WHERE c.id = ?2 AND ${readableCourse('?1')}`, id, courseId),
    statement(db, `
      SELECT s.id, COALESCE(l.title, s.title) AS title, COALESCE(l.task, s.task) AS task,
        s.visibility, s.methods, s.required, cs.requires,
        EXISTS(SELECT 1 FROM progress p WHERE p.stage_id = s.id AND p.user_id = ?1) AS marked,
        (SELECT json_group_array(kind) FROM submissions sub WHERE sub.stage_id = s.id AND sub.user_id = ?1) AS submitted
      FROM course_stages cs JOIN stages s ON s.id = cs.stage_id JOIN courses c ON c.id = cs.course_id
      LEFT JOIN course_stage_content l ON l.course_id = c.id AND l.stage_id = s.id
      WHERE cs.course_id = ?2 AND ${readableCourse('?1')} ORDER BY cs.position
    `, id, courseId),
    prerequisiteQuery(db, user, courseId),
  ])
  const course = courseResult.results[0]
  if (!course) fail(404, '课程不存在或当前账号无权访问。')
  const prerequisites = requirementsResult.results.map(item => ({ ...item, completed: Boolean(item.completed) }))
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
  // 能编辑课程的人可以预览全部关卡；学习者要先学会前置关卡，自己已学会的关卡始终可回看。
  const outline = stages.map(stage => ({ ...stage,
    locked: !Boolean(course.canEdit) && !stage.learned
      && stage.requires.some(dependency => !byId.get(dependency)?.learned) }))
  return { ...bools(course), prerequisites, learningLocked: lockedByPrerequisites(prerequisites), stages: outline }
}

export async function courseAtRevision(db, user, id, revision) {
  const course = await courseDetail(db, user, id)
  expectRevision(revision, course.revision)
  return course
}

export function courseOverview(course) {
  if (!course.learningLocked) return course
  return { ...course, stages: course.stages.map(({ id, title, learned, visibility }) => ({ id, title, learned, visibility })) }
}

// 课程只能引用自己创建的关卡，所以「可用」与「我的」两个范围一致。
export async function listStages(db, user, scope = 'owned') {
  const id = user?.id ?? ''
  choice(scope, ['available', 'owned'], '关卡范围')
  const list = await rows(statement(db, `
    SELECT s.id, s.title, s.task, s.visibility, 1 AS owned, u.name AS author,
      (SELECT COUNT(*) FROM course_stages cs WHERE cs.stage_id = s.id) AS courseCount,
      (SELECT COUNT(*) FROM progress p WHERE p.stage_id = s.id) AS learnedCount
    FROM stages s JOIN users u ON u.id = s.owner_id
    WHERE s.owner_id = ? ORDER BY s.updated_at DESC, s.title
  `, id))
  return list.map(stage => ({ ...stage, owned: true }))
}

function stageQuery(db, user, stageId, courseId) {
  const id = user?.id ?? ''
  if (courseId !== undefined && courseId !== null && courseId !== '') {
    field(courseId, '课程 ID', 100)
    return statement(db, `
      SELECT s.id, COALESCE(l.title, s.title) AS title, COALESCE(l.task, s.task) AS task,
        COALESCE(l.tutorial, s.tutorial) AS tutorial, s.visibility, s.methods, s.required, s.owner_id = ?1 AS owned,
        u.name AS author, l.stage_id IS NOT NULL AS customized
      FROM course_stages cs JOIN courses c ON c.id = cs.course_id JOIN stages s ON s.id = cs.stage_id
      JOIN users u ON u.id = s.owner_id
      LEFT JOIN course_stage_content l ON l.course_id = c.id AND l.stage_id = s.id
      WHERE c.id = ?2 AND s.id = ?3 AND ${readableCourse('?1')}
    `, id, courseId, stageId)
  }
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

export async function readableStage(db, user, stageId, courseId) {
  return stageData(await stageQuery(db, user, stageId, courseId).first())
}

export async function stageDetail(db, user, stageId, courseId) {
  const id = user?.id ?? ''
  const [stageResult, counts, submissions, answers] = await db.batch([
    stageQuery(db, user, stageId, courseId),
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
    statement(db, `
      SELECT field, value, updated_at FROM stage_answers WHERE stage_id = ? AND user_id = ? ORDER BY field
    `, stageId, id),
  ])
  const stage = stageData(stageResult.results[0])
  const { myLearned, ...stats } = counts.results[0]
  const missing = missingRequired(stage.required, submissions.results.map(entry => entry.kind))
  return { ...stage, learned: Boolean(myLearned) && !missing.length, stats,
    submissions: submissions.results, answers: answers.results, missing }
}

export async function studyStageDetail(db, user, stageId, courseId) {
  const stage = await stageDetail(db, user, stageId, courseId)
  await requireStageLearning(db, user, stageId, courseId)
  return stage
}

export async function ownedStage(db, user, stageId) {
  requireUser(user)
  const stage = await readableStage(db, user, stageId)
  if (!stage.owned) fail(403, '只有关卡作者可以编辑关卡。')
  return stage
}

async function commit(db, queries, conflict) {
  try {
    await db.batch(queries)
  } catch (error) {
    if (/course_stage_visibility|course_visibility|stage_visibility/.test(error.message)) fail(409, conflict)
    throw error
  }
}

// 关卡级依赖：只能指向本课程中排在当前关卡之前的关卡，兼做顺序约束与防成环。
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
  const actor = requireUser(user)
  expectEditor(data, actor)
  const current = courseId ? await courseDetail(db, user, courseId) : null
  if (current && !current.canEdit) fail(403, '当前账号没有课程编辑权限。')
  const revision = expectRevision(data.expectedRevision, current?.revision ?? 0)
  const title = field(data.title, '课程名称', 100)
  const description = field(data.description ?? '', '课程介绍', 1200, false)
  const category = choice(data.category ?? '其他', CATEGORIES, '课程分类')
  const theme = choice(data.theme ?? 'violet', THEMES, '课程主题色')
  const visibility = choice(data.visibility ?? current?.visibility ?? 'private', VISIBILITY, '课程可见性')
  if (current && !current.owned && visibility !== current.visibility) fail(403, '只有作者可以调整课程可见性。')
  const existingPrerequisites = (current?.prerequisites ?? []).map(({ courseId, mode }) => ({ courseId, mode }))
  const prerequisites = data.prerequisites === undefined ? existingPrerequisites : prerequisiteInput(data.prerequisites)
  const requirementsChanged = JSON.stringify(prerequisites) !== JSON.stringify(existingPrerequisites)
  if (requirementsChanged) {
    if (current && !current.owned) fail(403, '只有作者可以调整前置课程。')
    await validatePrerequisites(db, actor, prerequisites)
  }
  const existingIds = current?.stages.map(stage => stage.id) ?? []
  const selection = data.stageIds ?? existingIds
  if (!Array.isArray(selection) || selection.length > maxStages || new Set(selection).size !== selection.length) {
    fail(400, `每门课最多引用 ${maxStages} 个关卡，关卡不能重复。`)
  }
  for (const id of selection) field(id, '关卡 ID', 100)
  const drafts = data.newStages ?? []
  if (!Array.isArray(drafts) || drafts.length > selection.length || (current && drafts.length)) {
    fail(400, '请在课程内添加新关卡。')
  }
  const newStages = new Map()
  for (const draft of drafts) {
    const clientId = field(draft?.clientId, '新关卡标记', 100)
    if (!selection.includes(clientId) || newStages.has(clientId)) fail(400, '新关卡编排无效。')
    newStages.set(clientId, { ...stageInput({ ...draft, visibility: draft.visibility ?? visibility }), id: crypto.randomUUID() })
  }
  const added = selection.filter(id => !newStages.has(id) && !existingIds.includes(id))
  if (added.length) {
    if (current && !current.owned) fail(403, '只有课程作者可以引用自己的已有关卡。')
    const owned = await statement(db, `
      SELECT COUNT(*) AS total FROM stages s
      WHERE s.owner_id = ? AND s.id IN (SELECT value FROM json_each(?))
    `, actor, JSON.stringify(added)).first()
    if (owned.total !== added.length) fail(403, '只能引用自己创建的关卡。')
  }
  const ids = selection.map(id => newStages.get(id)?.id ?? id)
  if (visibility === 'public' && [...newStages.values()].some(stage => stage.visibility === 'private')) {
    fail(409, '发布课程前，请先公开选中的关卡，或移除私有的关卡。')
  }
  // 依赖可以用 clientId 指代同批创建的新关卡，统一换成真实 ID 再校验。
  const clientIds = new Map([...newStages].map(([clientId, stage]) => [clientId, stage.id]))
  const remapped = {}
  for (const [key, list] of Object.entries(data.requires ?? {})) {
    remapped[clientIds.get(key) ?? key] = Array.isArray(list) ? list.map(dep => clientIds.get(dep) ?? dep) : list
  }
  const requires = stageRequires({ requires: remapped }, ids)
  const existingRequires = new Map((current?.stages ?? []).map(stage => [stage.id, stage.requires ?? []]))
  const requiresChanged = ids.some(stageId =>
    JSON.stringify(requires.get(stageId) ?? []) !== JSON.stringify(existingRequires.get(stageId) ?? []))
  const id = courseId ?? crypto.randomUUID()
  const details = { title, description, category, theme, visibility }
  const reordered = JSON.stringify(ids) !== JSON.stringify(existingIds)
  const changed = !current || reordered || requirementsChanged || requiresChanged
    || Object.entries(details).some(([key, value]) => value !== current[key])
  if (!changed && !data.checkpoint) return current
  const queries = []
  if (current) {
    queries.push(guardCourse(db, id, actor, revision, { advance: changed }))
    if (changed) {
      const structure = reordered || requirementsChanged || requiresChanged || visibility !== current.visibility
      queries.push(...checkpoint(db, id, revision, actor, structure ? 'structure' : 'interval', { periodic: !structure }))
      if (reordered) queries.push(statement(db, `
        DELETE FROM course_stages WHERE course_id = ? AND stage_id NOT IN (SELECT value FROM json_each(?))
      `, id, JSON.stringify(ids)))
      if (requirementsChanged) queries.push(statement(db, 'DELETE FROM course_prerequisites WHERE course_id = ?', id))
      queries.push(statement(db, `
        UPDATE courses SET title = ?1, description = ?2, category = ?3, theme = ?4, visibility = ?5,
          edit_mode = CASE WHEN edit_mode = 'public' AND ?5 = 'private' THEN 'owner' ELSE edit_mode END,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?6
      `, title, description, category, theme, visibility, id))
    }
  } else {
    queries.push(statement(db, `
      INSERT INTO courses (title, description, category, theme, visibility, id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, title, description, category, theme, visibility, id, actor))
  }
  if (requirementsChanged) queries.push(insertPrerequisites(db, id, JSON.stringify(prerequisites)))
  for (const stage of newStages.values()) {
    queries.push(statement(db, `
      INSERT INTO stages (id, owner_id, title, task, tutorial, methods, required, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, stage.id, actor, stage.title, stage.task, stage.tutorial, JSON.stringify(stage.methods),
      JSON.stringify(stage.required), stage.visibility))
  }
  if (!current || reordered) {
    queries.push(statement(db, `
      INSERT INTO course_stages (course_id, stage_id, position) SELECT ?1, value, key FROM json_each(?2) WHERE 1
      ON CONFLICT(course_id, stage_id) DO UPDATE SET position = excluded.position
    `, id, JSON.stringify(ids)))
  }
  if (!current || reordered || requiresChanged) {
    for (const stageId of ids) {
      queries.push(statement(db, 'UPDATE course_stages SET requires = ? WHERE course_id = ? AND stage_id = ?',
        JSON.stringify(requires.get(stageId) ?? []), id, stageId))
    }
  }
  if (!current || data.checkpoint) {
    queries.push(...checkpoint(db, id, current ? revision + Number(changed) : 0, actor, current ? 'manual' : 'initial'))
  }
  await commitCourse(db, queries)
  return courseAtRevision(db, user, id, current ? revision + Number(changed) : 0)
}

export function stageInput(data) {
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
  return { title, task, tutorial, methods: selected, required: mustSubmit, visibility }
}

export async function saveStage(db, user, data, stageId) {
  const owner = requireUser(user)
  if (!stageId) fail(405, '请在课程编辑页创建关卡。')
  await ownedStage(db, user, stageId)
  const { title, task, tutorial, methods, required, visibility } = stageInput(data)
  const id = stageId
  const values = [title, task, tutorial, JSON.stringify(methods), JSON.stringify(required), visibility, id, owner]
  const write = statement(db, `UPDATE stages SET title = ?, task = ?, tutorial = ?, methods = ?, required = ?,
    visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?`, ...values)
  await commit(db, [write], '该关卡正在被公开课程或其他作者引用，请先解除相关引用。')
  return stageDetail(db, user, id)
}


// 教程里 {{ask:问题}} 的填写：按字段名存一条，value 为空表示清空。
export async function saveFieldAnswer(db, user, stageId, fieldName, value) {
  const id = requireUser(user)
  await readableStage(db, user, stageId)
  const name = field(fieldName, '提问项', 60)
  if (/[\n{}|]/.test(name)) fail(400, '提问项名称无效。')
  const text = field(value ?? '', '填写内容', 2000, false)
  if (!text) {
    await statement(db, 'DELETE FROM stage_answers WHERE stage_id = ? AND user_id = ? AND field = ?',
      stageId, id, name).run()
    return { field: name, value: '' }
  }
  await statement(db, `
    INSERT INTO stage_answers (stage_id, user_id, field, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (stage_id, user_id, field) DO UPDATE
    SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `, stageId, id, name, text).run()
  return { field: name, value: text }
}

export async function joinCourse(db, user, courseId) {
  const id = requireUser(user)
  const course = await courseDetail(db, user, courseId)
  if (course.learningLocked) fail(403, prerequisiteLockMessage)
  await statement(db, `
    INSERT OR IGNORE INTO enrollments (course_id, user_id)
    SELECT c.id, ?1 FROM courses c WHERE c.id = ?2 AND ${readableCourse('?1')}
  `, id, courseId).run()
  return courseDetail(db, user, courseId)
}

export async function joinFromStage(db, user, courseId, stageId) {
  if (typeof courseId !== 'string' || !courseId || courseId.length > 100) return
  await statement(db, `
    INSERT OR IGNORE INTO enrollments (course_id, user_id)
    SELECT c.id, ?1 FROM courses c JOIN course_stages cs ON cs.course_id = c.id
    WHERE c.id = ?2 AND cs.stage_id = ?3 AND ${readableCourse('?1')}
  `, user.id, courseId, stageId).run()
}

export async function markLearned(db, user, stageId, learned, courseId) {
  const id = requireUser(user)
  const stage = await readableStage(db, user, stageId, courseId)
  await requireStageLearning(db, user, stageId, courseId)
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
  return stageDetail(db, user, stageId, courseId)
}
