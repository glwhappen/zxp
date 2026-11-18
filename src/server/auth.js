import { fail, field, json, objectBody, requireUser, statement } from './core.js'

const COOKIE = 'workshop_session'
const LIFETIME = 30 * 24 * 60 * 60
const encoder = new TextEncoder()

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('')
}

function secret() {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

async function tokenHash(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const hash = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100_000,
  }, key, 256)
  return `${salt}:${hex(hash)}`
}

function equal(a, b) {
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

function cookieToken(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)workshop_session=([0-9a-f]{64})(?:;|$)/)?.[1]
}

function cookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export async function identify(request, db, mcp = false) {
  if (SITES_HOSTED) {
    const id = request.headers.get('oai-authenticated-user-id')
    if (!id) return null
    const fullName = request.headers.get('oai-authenticated-user-full-name')
    const email = request.headers.get('oai-authenticated-user-email')
    let name = fullName || email || '学习者'
    if (fullName && request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
      try { name = decodeURIComponent(fullName) } catch { name = email || '学习者' }
    }
    const user = { id: 'sites:' + id, name }
    await statement(db, 'INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)', user.id, user.name).run()
    return user
  }

  if (mcp) {
    const token = request.headers.get('Authorization')?.match(/^Bearer (sw_[0-9a-f]{64})$/)?.[1]
    if (!token) return null
    return statement(db, 'SELECT id, name FROM users WHERE token_hash = ?', await tokenHash(token)).first()
  }

  const token = cookieToken(request)
  if (!token) return null
  return statement(db, `
    SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `, await tokenHash(token), Date.now()).first()
}

export async function authenticate(request, db, action) {
  if (SITES_HOSTED) fail(404, '请使用 ChatGPT 账号登录。')
  if (action === 'logout') {
    const token = cookieToken(request)
    if (token) await statement(db, 'DELETE FROM sessions WHERE token_hash = ?', await tokenHash(token)).run()
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) })
  }
  const data = await objectBody(request, 4096)
  const username = field(data.username, '用户名', 32).toLowerCase()
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) fail(400, '用户名为 3–32 个字母、数字、下划线或短横线。')
  if (typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) {
    fail(400, '密码长度须为 8–128 个字符。')
  }
  let user = await statement(db, 'SELECT id, name, password_hash FROM users WHERE username = ?', username).first()
  if (action === 'register') {
    if (user) fail(409, '该用户名已被使用。')
    user = { id: crypto.randomUUID(), name: field(data.name, '昵称', 40) }
    const hashed = await passwordHash(data.password, secret())
    const result = await statement(db, `
      INSERT INTO users (id, name, username, password_hash) VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO NOTHING
    `, user.id, user.name, username, hashed).run()
    if (!result.meta.changes) fail(409, '该用户名已被使用。')
  } else {
    const stored = user?.password_hash ?? ''
    const computed = await passwordHash(data.password, stored.split(':')[0] || 'invalid-user')
    if (!equal(computed, stored)) fail(401, '用户名或密码错误。')
  }
  const token = secret()
  await db.batch([
    statement(db, 'DELETE FROM sessions WHERE expires_at <= ?', Date.now()),
    statement(db, 'INSERT INTO sessions VALUES (?, ?, ?)', await tokenHash(token), user.id, Date.now() + LIFETIME * 1000),
  ])
  return json({ user: { id: user.id, name: user.name } }, 200, { 'Set-Cookie': cookie(request, token, LIFETIME) })
}

export async function manageToken(db, user, action) {
  if (SITES_HOSTED) fail(404, '托管站点使用 Sites 的 MCP 连接。')
  const id = requireUser(user)
  const token = action === 'POST' ? 'sw_' + secret() : null
  await statement(db, 'UPDATE users SET token_hash = ? WHERE id = ?', token ? await tokenHash(token) : null, id).run()
  return token ? { token } : { ok: true }
}
