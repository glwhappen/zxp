import { readableCourse } from './course-access.js'
import { fail, field, requireUser, rows, statement } from './core.js'

const VISIBILITY = ['public', 'private']
const MAX_NOTES = 200

// 只做可见性检查，不依赖 learning.js，避免循环 import。
async function ensureStage(db, user, stageId) {
  const viewer = user?.id ?? ''
  // 关卡可读即可读写它的笔记：公开关卡、自己创建的关卡，或自己可读的课程里引用的关卡。
  const stage = await statement(db, `
    SELECT s.id FROM stages s
    WHERE s.id = ?2 AND (
      s.visibility = 'public' OR s.owner_id = ?1 OR EXISTS (
        SELECT 1 FROM course_stages cs JOIN courses c ON c.id = cs.course_id
        WHERE cs.stage_id = s.id AND ${readableCourse('?1')}
      )
    )
  `, viewer, stageId).first()
  if (!stage) fail(404, '关卡不存在或当前账号无权访问。')
  return stage
}

// 笔记/讨论：顶层一条笔记可选公开或私有；私有只有自己可见，公开的其他人可以回复。
// 回复只有一层，且只能挂在公开笔记下（父笔记转私有后，别人也看不到这些回复）。
export async function listNotes(db, user, stageId) {
  await ensureStage(db, user, stageId)
  const viewer = user?.id ?? ''
  const records = await rows(statement(db, `
    SELECT n.id, n.parent_id, n.body, n.visibility, n.created_at, n.updated_at,
      n.user_id = ?1 AS mine, u.name AS author
    FROM stage_notes n JOIN users u ON u.id = n.user_id
    WHERE n.stage_id = ?2
      AND (n.visibility = 'public' OR n.user_id = ?1)
    ORDER BY n.created_at, n.id
    LIMIT ${MAX_NOTES}
  `, viewer, stageId))

  const visible = new Set(records.map(record => record.id))
  const notes = []
  const byId = new Map()
  for (const record of records) {
    if (record.parent_id) continue
    const note = { ...record, mine: Boolean(record.mine), replies: [] }
    notes.push(note)
    byId.set(record.id, note)
  }
  for (const record of records) {
    if (!record.parent_id) continue
    // 父笔记不可见（私有或已删除）时，回复也不展示
    if (!visible.has(record.parent_id)) continue
    byId.get(record.parent_id)?.replies.push({ ...record, mine: Boolean(record.mine) })
  }
  return { notes: notes.reverse(), canWrite: Boolean(user) }
}

async function noteRow(db, stageId, noteId) {
  const note = await statement(db, `
    SELECT n.id, n.stage_id, n.parent_id, n.visibility, n.user_id FROM stage_notes n
    WHERE n.id = ? AND n.stage_id = ?
  `, noteId, stageId).first()
  if (!note) fail(404, '笔记不存在。')
  return note
}

export async function createNote(db, user, stageId, data) {
  const viewer = requireUser(user)
  await ensureStage(db, user, stageId)
  const body = field(data.body, '内容', 2000)
  let visibility = data.visibility ?? 'public'
  if (!VISIBILITY.includes(visibility)) fail(400, '可见性无效。')
  const parentId = data.parentId ? field(data.parentId, '父笔记 ID', 100) : null
  if (parentId) {
    const parent = await noteRow(db, stageId, parentId)
    if (parent.parent_id) fail(400, '回复不能再被回复。')
    if (parent.visibility !== 'public') fail(409, '私有笔记不接受回复。')
    visibility = 'public'
  }
  const id = crypto.randomUUID()
  await statement(db, `
    INSERT INTO stage_notes (id, stage_id, user_id, parent_id, body, visibility)
    VALUES (?, ?, ?, ?, ?, ?)
  `, id, stageId, viewer, parentId, body, visibility).run()
  return listNotes(db, user, stageId)
}

export async function updateNote(db, user, stageId, noteId, data) {
  const viewer = requireUser(user)
  const note = await noteRow(db, stageId, noteId)
  if (note.user_id !== viewer) fail(403, '只能修改自己写的笔记。')
  const visibility = data.visibility ?? note.visibility
  if (!VISIBILITY.includes(visibility)) fail(400, '可见性无效。')
  if (note.parent_id && visibility !== 'public') fail(400, '回复的可见性跟随父笔记。')
  const body = data.body === undefined ? null : field(data.body, '内容', 2000)
  await statement(db, `
    UPDATE stage_notes SET
      body = COALESCE(?, body),
      visibility = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, body, visibility, noteId).run()
  return listNotes(db, user, stageId)
}

export async function deleteNote(db, user, stageId, noteId) {
  const viewer = requireUser(user)
  const note = await noteRow(db, stageId, noteId)
  if (note.user_id !== viewer) fail(403, '只能删除自己写的笔记。')
  await statement(db, 'DELETE FROM stage_notes WHERE id = ?', noteId).run()
  return listNotes(db, user, stageId)
}

export async function noteSummary(db, user, stageId) {
  const viewer = user?.id ?? ''
  const counts = await rows(statement(db, `
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN visibility = 'public' THEN 1 END) AS public
    FROM stage_notes WHERE stage_id = ? AND (visibility = 'public' OR user_id = ?) AND parent_id IS NULL
  `, stageId, viewer))
  return counts[0] ?? { total: 0, public: 0 }
}
