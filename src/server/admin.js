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
    const { hidden } = await objectBody(request, 2000)
    if (typeof hidden !== 'boolean') fail(400, '请选择课程的下架状态。')
    const updated = await statement(db, `
      UPDATE courses SET moderated_at = CASE WHEN ? THEN COALESCE(moderated_at, CURRENT_TIMESTAMP) ELSE NULL END
      WHERE id = ? RETURNING id, moderated_at
    `, Number(hidden), id).first()
    if (!updated) fail(404, '课程不存在。')
    return json(updated)
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
      SELECT c.id, c.title, c.visibility, c.moderated_at, u.name AS author
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
  return json({ counts, courses, users, settings, q })
}
