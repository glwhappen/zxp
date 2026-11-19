import { choice, fail, field, json, objectBody, requireUser, rows, statement } from './core.js'
import { publicCourse } from './learning.js'

const statuses = ['open', 'closed']
const pageSize = 20
const replySize = 30

export async function listWishes(db, status = 'open', page = 1) {
  choice(status, [...statuses, 'all'], '许愿状态')
  const offset = (Number(page) - 1) * pageSize
  if (!Number.isSafeInteger(Number(page)) || !Number.isSafeInteger(offset) || offset < 0) fail(400, '页码无效。')
  const filter = status === 'all' ? '' : 'WHERE w.status = ?'
  const wishes = await rows(statement(db, `
    SELECT w.id, w.title, substr(w.goal, 1, 150) AS preview, w.status, w.updated_at, u.name AS author,
      (SELECT COUNT(*) FROM wish_replies r WHERE r.wish_id = w.id) AS replyCount,
      (SELECT COUNT(*) FROM wish_courses l JOIN courses c ON c.id = l.course_id
        WHERE l.wish_id = w.id AND ${publicCourse}) AS courseCount
    FROM wishes w JOIN users u ON u.id = w.author_id ${filter}
    ORDER BY w.updated_at DESC, w.id DESC LIMIT ? OFFSET ?
  `, ...(status === 'all' ? [] : [status]), pageSize + 1, offset))
  return { status, page: Number(page), items: wishes.slice(0, pageSize), hasNext: wishes.length > pageSize }
}

function replyQuery(db, id, before = null) {
  return statement(db, `
    SELECT r.id, r.body, r.created_at, u.name AS author
    FROM wish_replies r JOIN users u ON u.id = r.author_id
    WHERE r.wish_id = ? AND (? IS NULL OR r.id < ?) ORDER BY r.id DESC LIMIT ?
  `, id, before, before, replySize + 1)
}

function replyWindow(items) {
  const recent = items.slice(0, replySize).reverse()
  return { items: recent, before: items.length > replySize ? recent[0].id : null }
}

export async function wishReplies(db, id, before) {
  if (before !== null && (!Number.isSafeInteger(Number(before)) || Number(before) < 1)) fail(400, '回复位置无效。')
  const [wish, replies] = await db.batch([
    statement(db, 'SELECT 1 FROM wishes WHERE id = ?', id),
    replyQuery(db, id, before === null ? null : Number(before)),
  ])
  if (!wish.results.length) fail(404, '许愿已不存在。')
  return replyWindow(replies.results)
}

export async function wishDetail(db, user, id) {
  const [wish, replies, courses] = await db.batch([
    statement(db, `
      SELECT w.id, w.title, w.goal, w.approach, w.status, w.revision, w.created_at, w.updated_at,
        u.name AS author, w.author_id = ? AS mine
      FROM wishes w JOIN users u ON u.id = w.author_id WHERE w.id = ?
    `, user?.id ?? '', id),
    replyQuery(db, id),
    statement(db, `
      SELECT c.id, c.alias, c.title, c.category, l.reaction, u.name AS linkedBy
      FROM wish_courses l JOIN courses c ON c.id = l.course_id JOIN users u ON u.id = l.linked_by
      WHERE l.wish_id = ? AND ${publicCourse} ORDER BY l.created_at, c.id
    `, id),
  ])
  const item = wish.results[0]
  if (!item) fail(404, '许愿已不存在。')
  return { ...item, mine: Boolean(item.mine), replies: replyWindow(replies.results), courses: courses.results }
}

export async function createWish(db, user, input) {
  const author = requireUser(user)
  const id = crypto.randomUUID()
  const title = field(input.title, '标题', 120)
  const goal = field(input.goal, '学习需求', 4000)
  const approach = field(input.approach ?? '', '学习方式', 3000, false)
  await statement(db, 'INSERT INTO wishes (id, author_id, title, goal, approach) VALUES (?, ?, ?, ?, ?)',
    id, author, title, goal, approach).run()
  return wishDetail(db, user, id)
}

export async function replyToWish(db, user, id, input) {
  const author = requireUser(user)
  const body = field(input.body, '回复', 4000)
  const result = await statement(db, `
    INSERT INTO wish_replies (wish_id, author_id, body) SELECT id, ?, ? FROM wishes WHERE id = ?
  `, author, body, id).run()
  if (!result.meta.changes) fail(404, '许愿已不存在。')
  return wishDetail(db, user, id)
}

export async function linkWishCourse(db, user, id, input) {
  const author = requireUser(user)
  const course = field(input.courseId, '课程 ID', 100)
  await statement(db, `
    INSERT OR IGNORE INTO wish_courses (wish_id, course_id, linked_by)
    SELECT w.id, c.id, ? FROM wishes w CROSS JOIN courses c
    WHERE w.id = ? AND c.id = ? AND ${publicCourse}
  `, author, id, course).run()
  const wish = await wishDetail(db, user, id)
  if (!wish.courses.some(item => item.id === course)) fail(404, '只能关联可访问的公开课程。')
  return wish
}

async function wishAuthor(db, user, id) {
  const author = requireUser(user)
  const wish = await statement(db, 'SELECT author_id FROM wishes WHERE id = ?', id).first()
  if (!wish) fail(404, '许愿已不存在。')
  if (wish.author_id !== author) fail(403, '只有许愿者可以进行这项操作。')
  return author
}

export async function rateWishCourse(db, user, id, course, input) {
  const author = await wishAuthor(db, user, id)
  const reaction = choice(input.reaction, ['up', 'down', 'none'], '课程反馈')
  const result = await statement(db, `
    UPDATE wish_courses SET reaction = ?
    WHERE wish_id = ? AND course_id = ?
      AND EXISTS (SELECT 1 FROM wishes w WHERE w.id = wish_id AND w.author_id = ?)
      AND EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id AND ${publicCourse})
    RETURNING course_id
  `, reaction === 'none' ? null : reaction, id, course, author).first()
  if (!result) fail(404, '这门关联课程已经不可访问。')
  return wishDetail(db, user, id)
}

export async function setWishStatus(db, user, id, input) {
  const author = await wishAuthor(db, user, id)
  const status = choice(input.status, statuses, '许愿状态')
  await statement(db, `
    UPDATE wishes SET status = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND author_id = ? AND status <> ?
  `, status, id, author, status).run()
  return wishDetail(db, user, id)
}

export async function wishApi(request, db, user, url) {
  const [, , , id, action, resource, extra] = url.pathname.split('/')
  const method = request.method
  if (method === 'GET') {
    if (!id) return json(await listWishes(db, url.searchParams.get('status') ?? 'open', url.searchParams.get('page') ?? 1))
    if (!action) return json(await wishDetail(db, user, id))
    if (action === 'replies' && !resource) return json(await wishReplies(db, id, url.searchParams.get('before')))
  }
  if (method === 'POST' || method === 'PUT') {
    requireUser(user)
    const body = await objectBody(request, 40_000)
    if (method === 'POST' && !id) return json(await createWish(db, user, body), 201)
    if (method === 'POST' && id && !resource) {
      if (action === 'replies') return json(await replyToWish(db, user, id, body), 201)
      if (action === 'courses') return json(await linkWishCourse(db, user, id, body))
    }
    if (method === 'PUT' && id && action === 'status' && !resource) return json(await setWishStatus(db, user, id, body))
    if (method === 'PUT' && id && action === 'courses' && resource && !extra) return json(await rateWishCourse(db, user, id, resource, body))
  }
  fail(404, '许愿接口不存在。')
}
