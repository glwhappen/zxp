import { fail, field, json, objectBody, requireUser, statement } from './core.js'
import { getLoginSettings, oidcConfig } from './login-config.js'

const COOKIE = 'workshop_session'
const LIFETIME = 30 * 24 * 60 * 60
const encoder = new TextEncoder()

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('')
}

function secret() {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

export async function tokenHash(value) {
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

export function authCookie(request, name, value, maxAge, path = '/') {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

async function sitesUser(request, env) {
  const id = request.headers.get('oai-authenticated-user-id')
  if (!id) return null
  const fullName = request.headers.get('oai-authenticated-user-full-name')
  const email = request.headers.get('oai-authenticated-user-email')
  let name = fullName || email || '学习者'
  if (fullName && request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(fullName) } catch { name = email || '学习者' }
  }
  const isAdmin = Boolean(email && email.toLowerCase() === env.ZXP_ADMIN_CHATGPT_EMAIL?.trim().toLowerCase())
  const user = { id: 'sites:' + id, name, provider: 'chatgpt', isAdmin }
  await statement(env.DB, 'INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)', user.id, user.name).run()
  return user
}

export async function identify(request, env, { settings, mcp = false } = {}) {
  const { DB: db } = env
  const { methods } = settings ?? await getLoginSettings(env)

  if (mcp) {
    if (SITES_HOSTED) return methods.chatgpt ? sitesUser(request, env) : null
    const token = request.headers.get('Authorization')?.match(/^Bearer (sw_[0-9a-f]{64})$/)?.[1]
    if (!token) return null
    return statement(db, 'SELECT id, name FROM users WHERE token_hash = ?', await tokenHash(token)).first()
  }

  const token = cookieToken(request)
  if (token) {
    const user = await statement(db, `
      SELECT u.id, u.name, o.issuer, o.subject FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN oidc_accounts o ON o.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `, await tokenHash(token), Date.now()).first()
    const provider = user?.issuer ? 'oidc' : 'password'
    if (user && methods[provider]) {
      const oidc = provider === 'oidc' ? oidcConfig(env) : null
      if (provider === 'password' || user.issuer === oidc?.issuer) {
        const isAdmin = oidc ? user.subject === env.ZXP_ADMIN_OIDC_SUB?.trim()
          : user.id === env.ZXP_ADMIN_LOCAL_USER_ID?.trim()
        return { id: user.id, name: user.name, provider, isAdmin, ...(oidc ? { oidcSubject: user.subject } : {}) }
      }
    }
  }
  return methods.chatgpt && SITES_HOSTED ? sitesUser(request, env) : null
}

export async function startSession(request, db, id) {
  const token = secret()
  const previous = cookieToken(request)
  const now = Date.now()
  const queries = [
    statement(db, 'DELETE FROM sessions WHERE expires_at <= ?', now),
    statement(db, 'INSERT INTO sessions VALUES (?, ?, ?)', await tokenHash(token), id, now + LIFETIME * 1000),
  ]
  if (previous) queries.push(statement(db, 'DELETE FROM sessions WHERE token_hash = ?', await tokenHash(previous)))
  await db.batch(queries)
  return authCookie(request, COOKIE, token, LIFETIME)
}

async function countPasswordAttempt(db, username) {
  const now = Date.now()
  const [, result] = await db.batch([
    statement(db, 'DELETE FROM password_attempts WHERE expires_at <= ?', now),
    statement(db, `
      INSERT INTO password_attempts (username, expires_at, attempts) VALUES (?, ?, 1)
      ON CONFLICT(username) DO UPDATE SET attempts = password_attempts.attempts + 1
      RETURNING attempts
    `, username, now + 15 * 60 * 1000),
  ])
  if (result.results[0].attempts > 12) fail(429, '尝试次数过多，请稍后重试。')
}

export async function authenticate(request, env, action, settings) {
  const db = env.DB
  if (action === 'logout') {
    const token = cookieToken(request)
    if (token) await statement(db, 'DELETE FROM sessions WHERE token_hash = ?', await tokenHash(token)).run()
    return json({ ok: true }, 200, { 'Set-Cookie': authCookie(request, COOKIE, '', 0) })
  }
  if (!settings.methods.password) fail(403, '用户名和密码登录已关闭。')
  const data = await objectBody(request, 4096)
  const username = field(data.username, '用户名', 32).toLowerCase()
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) fail(400, '用户名为 3–32 个字母、数字、下划线或短横线。')
  if (typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) {
    fail(400, '密码长度须为 8–128 个字符。')
  }
  await countPasswordAttempt(db, username)
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
  await statement(db, 'DELETE FROM password_attempts WHERE username = ?', username).run()
  return json({ user: { id: user.id, name: user.name, provider: 'password',
    isAdmin: user.id === env.ZXP_ADMIN_LOCAL_USER_ID?.trim() } }, 200,
  { 'Set-Cookie': await startSession(request, db, user.id) })
}

export async function manageToken(db, user, action) {
  if (SITES_HOSTED) fail(404, '托管站点使用 Sites 的 MCP 连接。')
  const id = requireUser(user)
  const token = action === 'POST' ? 'sw_' + secret() : null
  await statement(db, 'UPDATE users SET token_hash = ? WHERE id = ?', token ? await tokenHash(token) : null, id).run()
  return token ? { token } : { ok: true }
}
