import { courseLabelKeys } from '../shared.js'
import { fail, field, json, objectBody, requireUser, rows, statement } from './core.js'
import { saveLoginSettings } from './login-config.js'

export async function adminApi(request, env, user, settings, url) {
  requireUser(user)
  if (!user.isAdmin) fail(403, '当前账号没有管理员权限。')
  const db = env.DB
  const [, , , resource, id] = url.pathname.split('/')
  if (request.method === 'PUT' && resource === 'login-methods' && !id) {
    return json(await saveLoginSettings(env, settings, await objectBody(request, 2000)))
  }
  if (request.method === 'PUT' && resource === 'courses' && id) {
    const body = await objectBody(request, 2000)
    if (typeof body.hidden !== 'boolean' && typeof body.featured !== 'boolean') {
      fail(400, '请选择课程的下架状态或精品标签。')
    }
    const course = await statement(db, 'SELECT id, labels, moderated_at FROM courses WHERE id = ?', id).first()
    if (!course) fail(404, '课程不存在。')
    const hidden = typeof body.hidden === 'boolean' ? body.hidden : Boolean(course.moderated_at)
    const labels = new Set(courseLabelKeys(course.labels))
    if (typeof body.featured === 'boolean') {
      if (body.featured) labels.add('featured')
      else labels.delete('featured')
    }
    const updated = await statement(db, `
      UPDATE courses SET
        moderated_at = CASE WHEN ? THEN COALESCE(moderated_at, CURRENT_TIMESTAMP) ELSE NULL END,
        labels = ?
      WHERE id = ? RETURNING id, moderated_at, labels
    `, Number(hidden), JSON.stringify([...labels]), id).first()
    return json({ ...updated, labels: courseLabelKeys(updated.labels) })
  }
  if (request.method !== 'GET' || resource) fail(404, '管理接口不存在。')
  const q = field(url.searchParams.get('q') ?? '', '课程搜索', 100, false)
  const [counts, courses, users] = await Promise.all([
    statement(db, `
      SELECT (SELECT COUNT(*) FROM users WHERE id <> 'workshop-examples') AS users,
        (SELECT COUNT(*) FROM courses) AS courses, (SELECT COUNT(*) FROM stages) AS stages,
        (SELECT COUNT(*) FROM submissions) AS submissions
    `).first(),
    rows(statement(db, `
      SELECT c.id, c.title, c.visibility, c.moderated_at, c.labels, u.name AS author
      FROM courses c JOIN users u ON u.id = c.owner_id
      WHERE instr(lower(c.title), lower(?)) > 0 OR instr(lower(u.name), lower(?)) > 0
      ORDER BY c.updated_at DESC, c.id LIMIT 50
    `, q, q)),
    rows(statement(db, `
      SELECT u.id, u.name, CASE WHEN o.user_id IS NOT NULL THEN 'oidc'
        WHEN u.username IS NOT NULL THEN 'password' ELSE 'chatgpt' END AS provider
      FROM users u LEFT JOIN oidc_accounts o ON o.user_id = u.id
      WHERE u.id <> 'workshop-examples' ORDER BY u.name, u.id LIMIT 50
    `)),
  ])
  return json({ counts, courses: courses.map(course => ({ ...course, labels: courseLabelKeys(course.labels) })),
    users, settings, q })
}
