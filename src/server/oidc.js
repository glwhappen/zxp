import * as oauth from 'oauth4webapi'
import { authCookie, startSession, tokenHash } from './auth.js'
import { fail, statement } from './core.js'
import { oidcConfig } from './login-config.js'

export const callbackPath = '/api/auth/oidc/callback'
const STATE_COOKIE = 'zxp_oidc_state'
const STATE_PATH = '/api/auth/oidc'
const FLOW_SECONDS = 8 * 60
const loopback = ['127.0.0.1', 'localhost', '[::1]']

function endpoint(url, config) {
  const parsed = new URL(url)
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:'
    && !(config.insecure && parsed.protocol === 'http:' && loopback.includes(parsed.hostname)))) {
    throw new Error('OIDC endpoint protocol is invalid.')
  }
  return parsed
}

function options(config) {
  return {
    [oauth.allowInsecureRequests]: config.insecure,
    [oauth.customFetch]: (url, init) => fetch(endpoint(url, config), { ...init, signal: AbortSignal.timeout(9000) }),
  }
}

async function discover(config, http) {
  const metadata = await oauth.processDiscoveryResponse(config.url, await oauth.discoveryRequest(config.url, http))
  if (metadata.issuer !== config.issuer) throw new Error('OIDC issuer mismatch.')
  return metadata
}

function callbackUrl(request, env) {
  const url = new URL(callbackPath, request.url)
  if (env.OIDC_REDIRECT_URI && url.href !== env.OIDC_REDIRECT_URI.trim()) {
    fail(400, '请从配置的站点地址发起 OIDC 登录。')
  }
  if (url.protocol !== 'https:' && !(!SITES_HOSTED && loopback.includes(url.hostname))) {
    fail(400, 'OIDC 回调地址需要 HTTPS。')
  }
  return url.href
}

function returnPath(query, origin) {
  if (!query?.startsWith('/') || query.startsWith('//') || query.length > 1500) return '/'
  const url = new URL(query, origin)
  return url.origin === origin ? url.pathname + url.search + url.hash : '/'
}

function redirect(target, cookies) {
  const headers = new Headers({ Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 303, headers })
}

export async function beginOidc(request, env, settings) {
  const config = oidcConfig(env)
  if (!settings.methods.oidc || !config) fail(403, 'OIDC 登录未开启。')
  const redirectUri = callbackUrl(request, env)
  const url = new URL(request.url)
  let target
  try {
    const metadata = await discover(config, options(config))
    target = endpoint(metadata.authorization_endpoint, config)
  } catch {
    fail(502, '暂时无法连接 OIDC 登录服务。')
  }

  const state = oauth.generateRandomState()
  const nonce = oauth.generateRandomNonce()
  const verifier = oauth.generateRandomCodeVerifier()
  const now = Date.now()
  const db = env.DB
  await db.batch([
    statement(db, 'DELETE FROM oidc_flows WHERE expires_at <= ?', now),
    statement(db, 'INSERT INTO oidc_flows VALUES (?, ?, ?, ?, ?, ?, ?, ?)', await tokenHash(state),
      config.issuer, config.clientId, nonce, verifier, returnPath(url.searchParams.get('return_to'), url.origin),
      redirectUri, now + FLOW_SECONDS * 1000),
  ])
  const parameters = {
    client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile',
    code_challenge_method: 'S256', code_challenge: await oauth.calculatePKCECodeChallenge(verifier), state, nonce,
  }
  for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value)
  return redirect(target.href, [authCookie(request, STATE_COOKIE, state, FLOW_SECONDS, STATE_PATH)])
}

async function verifyCode(url, flow, config, state) {
  const http = options(config)
  const metadata = await discover(config, http)
  const client = { client_id: config.clientId }
  const auth = {
    client_secret_basic: oauth.ClientSecretBasic,
    client_secret_post: oauth.ClientSecretPost,
    none: oauth.None,
  }[config.auth](config.secret)
  const params = oauth.validateAuthResponse(metadata, client, url, state)
  const response = await oauth.authorizationCodeGrantRequest(
    metadata, client, auth, params, flow.redirect_uri, flow.verifier, http)
  const result = await oauth.processAuthorizationCodeResponse(metadata, client, response,
    { expectedNonce: flow.nonce, requireIdToken: true })
  await oauth.validateApplicationLevelSignature(metadata, response, http)
  return oauth.getValidatedIdTokenClaims(result)
}

async function ensureAccount(db, issuer, claims) {
  const subject = claims?.sub
  if (typeof subject !== 'string' || !subject || subject.length > 255) throw new Error('Invalid OIDC subject.')
  const id = 'oidc:' + await tokenHash(issuer + '\0' + subject)
  const display = [claims.name, claims.preferred_username].find(name => typeof name === 'string' && name.trim())
  await db.batch([
    statement(db, 'INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)', id, display?.trim().slice(0, 80) || 'OIDC 学习者'),
    statement(db, 'INSERT OR IGNORE INTO oidc_accounts (issuer, subject, user_id) VALUES (?, ?, ?)', issuer, subject, id),
  ])
  return id
}

export async function finishOidc(request, env, settings) {
  const config = oidcConfig(env)
  if (!settings.methods.oidc || !config) fail(403, 'OIDC 登录未开启。')
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const browserState = request.headers.get('Cookie')?.match(/(?:^|;\s*)zxp_oidc_state=([A-Za-z0-9_-]{32,128})(?:;|$)/)?.[1]
  if (!state || state !== browserState) fail(400, 'OIDC 登录状态无效，请重新发起登录。')
  const flow = await statement(env.DB, `
    DELETE FROM oidc_flows WHERE state_hash = ? AND expires_at > ?
    RETURNING issuer, client_id, nonce, verifier, return_to, redirect_uri
  `, await tokenHash(state), Date.now()).first()
  if (!flow || flow.issuer !== config.issuer || flow.client_id !== config.clientId
    || flow.redirect_uri !== callbackUrl(request, env)) {
    fail(400, 'OIDC 登录请求已过期，请重新登录。')
  }
  const target = new URL(returnPath(flow.return_to, url.origin), url.origin)
  const clearState = authCookie(request, STATE_COOKIE, '', 0, STATE_PATH)
  try {
    const claims = await verifyCode(url, flow, config, state)
    const id = await ensureAccount(env.DB, config.issuer, claims)
    return redirect(target.href, [clearState, await startSession(request, env.DB, id)])
  } catch {
    target.searchParams.set('auth_error', 'oidc')
    return redirect(target.href, [clearState])
  }
}
