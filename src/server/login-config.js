import { fail, statement } from './core.js'

export const loginMethods = ['chatgpt', 'password', 'oidc']

export function oidcConfig(env) {
  const issuer = env.OIDC_ISSUER?.trim()
  const clientId = env.OIDC_CLIENT_ID?.trim()
  const auth = env.OIDC_CLIENT_AUTH?.trim() || 'client_secret_basic'
  if (!issuer || !clientId || !['client_secret_basic', 'client_secret_post', 'none'].includes(auth)) return null
  if (auth !== 'none' && !env.OIDC_CLIENT_SECRET) return null
  try {
    const url = new URL(issuer)
    const insecure = !SITES_HOSTED && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !insecure) || url.username || url.password || url.search || url.hash) return null
    return { issuer, url, insecure, clientId, auth, secret: env.OIDC_CLIENT_SECRET,
      label: env.OIDC_LABEL?.trim().slice(0, 32) || 'OIDC 单点登录' }
  } catch {
    return null
  }
}

export async function getLoginSettings(env) {
  const oidc = oidcConfig(env)
  const available = { chatgpt: SITES_HOSTED, password: true, oidc: Boolean(oidc) }
  const forced = env.ZXP_LOGIN_METHODS?.trim()
  const stored = forced ? Object.fromEntries(forced.split(',').map(method => [method.trim(), 1]))
    : await statement(env.DB, 'SELECT chatgpt, password, oidc FROM login_settings WHERE id = 1').first()
  const methods = Object.fromEntries(loginMethods.map(key => [key, available[key] && (!stored || Boolean(stored[key]))]))
  return { methods, available, oidcLabel: oidc?.label ?? 'OIDC 单点登录', locked: Boolean(forced) }
}

export async function saveLoginSettings(env, settings, methods) {
  if (settings.locked) fail(409, '登录方式由部署配置管理。')
  if (loginMethods.some(key => typeof methods[key] !== 'boolean' || (methods[key] && !settings.available[key]))) {
    fail(400, '请选择已配置的登录方式。')
  }
  if (!loginMethods.some(key => methods[key])) fail(400, '至少启用一种登录方式。')
  const adminPath = (methods.chatgpt && env.ZXP_ADMIN_CHATGPT_EMAIL?.trim())
    || (methods.password && env.ZXP_ADMIN_LOCAL_USER_ID?.trim())
    || (methods.oidc && env.ZXP_ADMIN_OIDC_SUB?.trim())
  if (!adminPath) fail(409, '至少保留一种已配置管理员身份的登录方式。')
  await statement(env.DB, `
    INSERT INTO login_settings (id, chatgpt, password, oidc) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET chatgpt = excluded.chatgpt, password = excluded.password, oidc = excluded.oidc
  `, ...loginMethods.map(key => Number(methods[key]))).run()
  return { ...settings, methods: Object.fromEntries(loginMethods.map(key => [key, methods[key]])) }
}
