import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { buildSite } from '../scripts/build.mjs'

const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
let server
let temp
let origin
let workerLog = ''

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  return port
}

before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'skill-workshop-'))
  const outfile = join(temp, 'worker.mjs')
  const persist = join(temp, 'state')
  const port = await freePort()
  origin = 'http://127.0.0.1:' + port
  await mkdir(persist)
  await buildSite({ outfile })
  await promisify(execFile)(process.execPath,
    [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { env, timeout: 35_000 })
  server = spawn(process.execPath, [wrangler, 'dev', outfile, '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--persist-to', persist], { env, stdio: ['ignore', 'pipe', 'pipe'] })
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
  if (temp) await rm(temp, { recursive: true, maxRetries: 10, retryDelay: 250 })
})

function request(path, { method = 'GET', cookie, json, body, headers = {} } = {}) {
  if (cookie) headers.Cookie = cookie
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }
  return fetch(origin + path, { method, headers, body, signal: AbortSignal.timeout(10_000) })
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
  const created = await rpc('tools/call', { name: 'course_create', arguments: { title: 'MCP 课程', stageIds: ['api-setup'] } })
  const course = JSON.parse(created.result.content[0].text)
  assert.equal(course.stages[0].id, 'api-setup')
  assert.equal(course.visibility, 'private')
  assert.equal((await data('/api/courses?scope=owned', { cookie }))[0].id, course.id)
  await data('/api/token', { method: 'DELETE', cookie })
  await rpc('tools/call', { name: 'course_list' }, token, 401)
})
