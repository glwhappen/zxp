import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { buildSite } from '../scripts/build.mjs'

const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
const config = resolve('wrangler.jsonc')
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
let server
let temp
let origin
let workerLog = ''
let provider
let issuer
const codes = new Map()

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  return port
}

function mockOidc() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
  return httpServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    if (req.url === '/.well-known/openid-configuration') {
      reply(200, { issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/keys', id_token_signing_alg_values_supported: ['RS256'] })
    } else if (req.url === '/keys') {
      reply(200, { keys: [jwk] })
    } else if (req.url === '/token' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const params = new URLSearchParams(body)
      const code = params.get('code')
      const approval = codes.get(code)
      codes.delete(code)
      const verifier = params.get('code_verifier')
      if (!approval || params.get('client_id') !== 'test-app' || params.get('client_secret') !== 'test-only-oidc'
        || params.get('redirect_uri') !== approval.redirect || !verifier
        || createHash('sha256').update(verifier).digest('base64url') !== approval.challenge) {
        reply(400, { error: 'invalid_grant' })
        return
      }
      const iat = Math.floor(Date.now() / 1000)
      const enc = data => Buffer.from(JSON.stringify(data)).toString('base64url')
      const jwt = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({
        iss: issuer, aud: 'test-app', sub: approval.subject, iat, exp: iat + 120,
        nonce: approval.nonce, name: 'OIDC 学习者',
      })
      const signature = sign('sha256', Buffer.from(jwt), privateKey)
      if (approval.badSignature) signature[0] ^= 1
      reply(200, { id_token: jwt + '.' + signature.toString('base64url'), access_token: 'test-only-token', token_type: 'Bearer' })
    } else {
      reply(404, { error: 'not_found' })
    }
  })
}

before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'skill-workshop-'))
  const outfile = join(temp, 'worker.mjs')
  const persist = join(temp, 'state')
  const port = await freePort()
  origin = 'http://127.0.0.1:' + port
  provider = mockOidc().listen(0, '127.0.0.1')
  await once(provider, 'listening')
  issuer = 'http://127.0.0.1:' + provider.address().port
  await mkdir(persist)
  await buildSite({ outfile })
  await promisify(execFile)(process.execPath,
    [wrangler, 'd1', 'migrations', 'apply', 'DB', '--config', config, '--local', '--persist-to', persist], { env, timeout: 35_000 })
  server = spawn(process.execPath, [wrangler, 'dev', outfile, '--config', config, '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--persist-to', persist,
    '--var', 'OIDC_ISSUER:' + issuer, '--var', 'OIDC_CLIENT_ID:test-app',
    '--var', 'OIDC_CLIENT_SECRET:test-only-oidc', '--var', 'OIDC_CLIENT_AUTH:client_secret_post',
    '--var', 'ZXP_ADMIN_OIDC_SUB:owner-test'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => {
    workerLog = (workerLog + chunk).slice(-8000)
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && server.exitCode === null) {
    const health = await fetch(origin + '/api/courses', { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (health?.ok) return
    await delay(250)
  }
  throw new Error('Test Worker could not start.\n' + workerLog.slice(-3300))
})

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit')
    server.kill()
    await exited
  }
  if (provider?.listening) await new Promise(resolve => provider.close(resolve))
  if (temp) await rm(temp, { recursive: true, maxRetries: 10, retryDelay: 250 })
})

function request(path, { method = 'GET', cookie, json, body, headers = {}, redirect = 'follow' } = {}) {
  if (cookie) headers.Cookie = cookie
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }
  return fetch(origin + path, { method, headers, body, redirect, signal: AbortSignal.timeout(10_000) })
}

async function data(path, options, status = 200) {
  const res = await request(path, options)
  const value = await res.json()
  assert.equal(res.status, status, JSON.stringify(value))
  return value
}

async function register(username) {
  const res = await request('/api/auth/register', {
    method: 'POST', json: { username, name: username, password: 'test-only-12345' },
  })
  assert.equal(res.status, 200, res.ok ? '' : (await res.text()) + '\n' + workerLog.slice(-2000))
  return res.headers.get('Set-Cookie').split(';')[0]
}

test('public levels share progress while private courses and submissions enforce ownership', async () => {
  const alice = await register('alice')
  const bob = await register('bob')
  const stage = await data('/api/stages', { method: 'POST', cookie: alice, json: {
    title: '我的共享关卡', task: '验证跨课程进度', tutorial: '## 练习',
    methods: ['learned', 'answer', 'screenshot', 'file'], visibility: 'public',
  } }, 201)
  const first = await data('/api/courses', { method: 'POST', cookie: alice, json: {
    title: '公开课程', visibility: 'public', stageIds: [stage.id],
  } }, 201)
  const second = await data('/api/courses', { method: 'POST', cookie: bob, json: {
    title: '私有课程', stageIds: [stage.id],
  } }, 201)
  await data('/api/courses/' + second.id, { cookie: alice }, 404)
  const path = '/api/stages/' + stage.id
  await data(path, { method: 'PUT', cookie: bob, json: {} }, 403)
  await data(path, { method: 'PUT', cookie: alice, json: { ...stage, visibility: 'private' } }, 409)
  for (const answer of ['第一版', '第二版']) {
    const result = await data(path + '/answer', { method: 'PUT', cookie: bob, json: { answer, courseId: first.id } })
    assert.equal(result.stats.answer, 1)
    assert.equal(result.learned, false)
    assert.equal(result.submissions[0].answer, answer)
  }
  for (let i = 0; i < 2; i++) {
    await data(path + '/learned', { method: 'PUT', cookie: bob, json: { learned: true, courseId: first.id } })
  }
  const reused = await data('/api/courses/' + second.id, { cookie: bob })
  assert.equal(reused.completedCount, 1)
  assert.equal(reused.stages[0].learned, true)
  const otherUser = await data(path, { cookie: alice })
  assert.deepEqual(otherUser.stats, { learned: 1, answer: 1, screenshot: 0, file: 0, participants: 1 })
  assert.equal(otherUser.learned, false)
  assert.deepEqual(otherUser.submissions, [])
  await data(path + '/learned', { method: 'PUT', cookie: bob, json: { learned: false } })
  assert.equal((await data('/api/courses/' + first.id, { cookie: bob })).completedCount, 0)
  assert.equal((await data('/api/courses?scope=joined', { cookie: bob })).length, 1)
})

test('screenshots and replacement files stay private and are counted once', async () => {
  const user = await register('uploads')
  const path = '/api/stages/image-finish/upload/'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNv8AAAAASUVORK5CYII=', 'base64')
  await data(path + 'screenshot?filename=bad.png', { method: 'PUT', cookie: user, body: 'fake image' }, 400)
  await data(path + 'screenshot?filename=sample.png', { method: 'PUT', cookie: user, body: png })
  const preview = await request(path + 'screenshot?preview=1', { cookie: user })
  assert.equal(preview.headers.get('Content-Type'), 'image/png')
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png)
  for (const value of ['first', 'second']) {
    const result = await data(path + 'file?filename=project.txt', { method: 'PUT', cookie: user, body: value })
    assert.equal(result.stats.file, 1)
    assert.equal(result.stats.participants, 1)
  }
  const file = await request(path + 'file', { cookie: user })
  assert.match(file.headers.get('Content-Disposition'), /^attachment/)
  assert.equal(await file.text(), 'second')
  await data(path + 'file', { cookie: await register('visitor') }, 404)
  await data(path + 'file', {}, 401)
})

test('MCP creates courses with a revocable user token', async () => {
  const cookie = await register('mcpuser')
  const { token } = await data('/api/token', { method: 'POST', cookie })
  function rpc(method, params = {}, credential = token, status = 200) {
    return data('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + credential, 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method,
        ...(params.name ? { 'Mcp-Name': params.name } : {}) },
      json: { jsonrpc: '2.0', id: 1, method, params },
    }, status)
  }
  const discovery = await rpc('server/discover')
  assert.equal(discovery.result.supportedVersions[0], '2026-07-28')
  const listing = await rpc('tools/list')
  assert(listing.result.tools.some(tool => tool.name === 'course_create'))
  const created = await rpc('tools/call', { name: 'course_create', arguments: {
    title: 'MCP 课程', stageIds: ['api-setup', 'video-shots'], requires: { 'video-shots': ['api-setup'] },
  } })
  const course = JSON.parse(created.result.content[0].text)
  assert.equal(course.stages[0].id, 'api-setup')
  assert.deepEqual(course.stages[1].requires, ['api-setup'])
  assert.deepEqual(course.stages[0].required, ['answer'])
  assert.equal(course.visibility, 'private')
  assert.equal((await data('/api/courses?scope=owned', { cookie }))[0].id, course.id)
  await data('/api/token', { method: 'DELETE', cookie })
  await rpc('tools/call', { name: 'course_list' }, token, 401)
})

test('required submissions gate the learned state everywhere', async () => {
  const owner = await register('requireowner')
  const learner = await register('requirelearner')
  const form = {
    title: '必填关卡', task: '提交答案才能学会', tutorial: '## 练习',
    methods: ['learned', 'answer', 'file'], required: ['answer'], visibility: 'public',
  }
  const stage = await data('/api/stages', { method: 'POST', cookie: owner, json: form }, 201)
  assert.deepEqual(stage.required, ['answer'])
  assert.deepEqual(stage.missing, ['answer'])
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '必填课程', visibility: 'public', stageIds: [stage.id],
  } }, 201)
  const path = '/api/stages/' + stage.id
  await data(path + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } }, 409)
  const answered = await data(path + '/answer', { method: 'PUT', cookie: learner, json: { answer: '我的答案', courseId: course.id } })
  assert.deepEqual(answered.missing, [])
  assert.equal(answered.learned, false)
  const learned = await data(path + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } })
  assert.equal(learned.learned, true)
  assert.equal((await data('/api/courses/' + course.id, { cookie: learner })).completedCount, 1)
  assert.equal((await data('/api/courses?scope=joined', { cookie: learner }))[0].completedCount, 1)

  await data(path, { method: 'PUT', cookie: owner, json: { ...form, required: ['answer', 'file'] } })
  const stale = await data('/api/courses/' + course.id, { cookie: learner })
  assert.equal(stale.completedCount, 0)
  assert.equal(stale.stages[0].learned, false)
  assert.deepEqual(stale.stages[0].missing, ['file'])
  await data(path, { method: 'PUT', cookie: owner, json: { ...form, methods: ['learned', 'answer'], required: ['screenshot'] } }, 400)
})

test('course stage dependencies lock later stages until prerequisites are learned', async () => {
  const owner = await register('depowner')
  const learner = await register('deplearner')
  const make = title => data('/api/stages', { method: 'POST', cookie: owner, json: {
    title, task: title + '的任务', methods: ['learned'], visibility: 'public',
  } }, 201)
  const [first, second, third] = [await make('步骤一'), await make('步骤二'), await make('步骤三')]
  const form = {
    title: '依赖课程', visibility: 'public', stageIds: [first.id, second.id, third.id],
    requires: { [second.id]: [first.id], [third.id]: [first.id, second.id] },
  }
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: form }, 201)
  assert.deepEqual(course.stages[1].requires, [first.id])
  assert.deepEqual(course.stages.map(stage => stage.locked), [false, false, false])

  const locked = await data('/api/courses/' + course.id, { cookie: learner })
  assert.deepEqual(locked.stages.map(stage => stage.locked), [false, true, true])

  await data('/api/stages/' + first.id + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } })
  const unlocked = await data('/api/courses/' + course.id, { cookie: learner })
  assert.deepEqual(unlocked.stages.map(stage => stage.locked), [false, false, true])
  assert.equal(unlocked.completedCount, 1)

  await data('/api/courses/' + course.id, { method: 'PUT', cookie: owner, json: {
    ...form, requires: { [first.id]: [second.id] },
  } }, 400)
  await data('/api/courses/' + course.id, { method: 'PUT', cookie: owner, json: {
    ...form, requires: { [second.id]: [second.id] },
  } }, 400)
})

test('navigation resolves profile and course-stage data together without exposing other records', async () => {
  const cookie = await register('viewreader')
  const view = async (path, owner) => data('/api/view?path=' + encodeURIComponent(path), { cookie: owner })
  const result = await view('/course/ai-image/stage/api-setup', cookie)
  assert.equal(result.profile.user.name, 'viewreader')
  assert.equal(result.view.course.id, 'ai-image')
  assert.equal(result.view.stage.id, 'api-setup')
  const foreign = await view('/course/web-basics/stage/api-setup', cookie)
  assert.equal(foreign.view.status, 404)
  assert.equal(foreign.view.stage, undefined)
  const locked = await data('/api/courses', {
    method: 'POST', cookie, json: { title: '仅作者可见', visibility: 'private' },
  }, 201)
  const blocked = await view('/course/' + locked.id)
  assert.equal(blocked.view.status, 404)
  assert.equal(blocked.view.course, undefined)
  const html = await request('/')
  const script = (await html.text()).match(/src="(\/assets\/app\.[a-f0-9]+\.js)"/)[1]
  const asset = await request(script)
  assert.match(asset.headers.get('Cache-Control'), /immutable/)
  assert.equal((await request('/api/view?path=%2F')).headers.get('Cache-Control'), 'no-store')
})

async function oidcFlow({ badSignature = false, badNonce = false } = {}) {
  const start = await request('/api/auth/oidc/start?return_to=%2Fadmin', { redirect: 'manual' })
  assert.equal(start.status, 303, await start.text())
  const authorize = new URL(start.headers.get('Location'))
  assert.equal(authorize.origin, issuer)
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  const code = 'code-' + crypto.randomUUID()
  codes.set(code, {
    redirect: authorize.searchParams.get('redirect_uri'),
    challenge: authorize.searchParams.get('code_challenge'),
    nonce: badNonce ? 'wrong-nonce' : authorize.searchParams.get('nonce'),
    subject: 'owner-test', badSignature,
  })
  const state = authorize.searchParams.get('state')
  const path = '/api/auth/oidc/callback?' + new URLSearchParams({ code, state })
  return { path, browserCookie: start.headers.get('Set-Cookie').split(';')[0] }
}

test('OIDC validates signed identity and only admins can manage login methods and courses', async () => {
  const normal = await register('normaluser')
  await data('/api/admin', {}, 401)
  await data('/api/admin', { cookie: normal }, 403)
  const methods = { chatgpt: false, password: false, oidc: true }
  await data('/api/admin/login-methods', { method: 'PUT', cookie: normal, json: methods }, 403)
  for (const options of [{ badSignature: true }, { badNonce: true }]) {
    const { path, browserCookie } = await oidcFlow(options)
    const rejected = await request(path, { cookie: browserCookie, redirect: 'manual' })
    assert.equal(rejected.status, 303)
    assert.equal(new URL(rejected.headers.get('Location')).searchParams.get('auth_error'), 'oidc')
    assert(!rejected.headers.getSetCookie().some(cookie => cookie.startsWith('workshop_session=')))
  }
  const { path, browserCookie } = await oidcFlow()
  await data(path, { redirect: 'manual' }, 400)
  const callback = await request(path, { cookie: browserCookie, redirect: 'manual' })
  assert.equal(callback.status, 303, await callback.text())
  assert.equal(new URL(callback.headers.get('Location')).pathname, '/admin')
  assert.equal(new URL(callback.headers.get('Location')).search, '')
  const cookie = callback.headers.getSetCookie().find(value => value.startsWith('workshop_session=')).split(';')[0]
  const me = await data('/api/me', { cookie })
  assert.equal(me.user.provider, 'oidc')
  assert.equal(me.user.isAdmin, true)
  assert.equal(me.user.oidcSubject, 'owner-test')
  await data(path, { cookie: browserCookie, redirect: 'manual' }, 400)

  const admin = await data('/api/admin?q=AI', { cookie })
  assert(admin.courses.some(course => course.id === 'ai-image'))
  await data('/api/admin/courses/ai-image', { method: 'PUT', cookie, json: { hidden: true } })
  assert(!(await data('/api/courses', {})).some(course => course.id === 'ai-image'))
  await data('/api/courses/ai-image', {}, 404)
  await data('/api/admin/courses/ai-image', { method: 'PUT', cookie, json: { hidden: false } })
  await data('/api/courses/ai-image', {})

  await data('/api/admin/login-methods', {
    method: 'PUT', cookie, json: { chatgpt: false, password: true, oidc: false },
  }, 409)
  await data('/api/admin/login-methods', { method: 'PUT', cookie, json: methods })
  const after = await data('/api/me', { cookie: normal })
  assert.deepEqual(after.login.methods, methods)
  assert.equal(after.user, null)
  for (const action of ['register', 'login']) {
    await data('/api/auth/' + action, { method: 'POST', json: { username: 'normaluser', password: 'test-only-12345' } }, 403)
  }
  const again = await oidcFlow()
  const repeat = await request(again.path, { cookie: again.browserCookie, redirect: 'manual' })
  const repeatCookie = repeat.headers.getSetCookie().find(value => value.startsWith('workshop_session=')).split(';')[0]
  assert.equal((await data('/api/me', { cookie: repeatCookie })).user.id, me.user.id)
  await data('/api/auth/logout', { method: 'POST', cookie })
  assert.equal((await data('/api/me', { cookie })).user, null)
})
