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

test('own levels stay reusable across own courses and cannot be borrowed by others', async () => {
  const alice = await register('alice')
  const bob = await register('bob')
  const first = await data('/api/courses', { method: 'POST', cookie: alice, json: {
    title: '公开课程', visibility: 'public', stageIds: ['shared-step'], newStages: [{
      clientId: 'shared-step', title: '我的共享关卡', task: '验证跨课程进度',
      tutorial: '## 练习\n\n{{submit:answer|写下你的答案}}\n\n{{submit:screenshot|上传一张截图}}\n\n{{submit:file|上传你的文件}}',
      methods: ['learned', 'answer', 'screenshot', 'file'],
    }],
  } }, 201)
  const [stage] = first.stages
  const second = await data('/api/courses', { method: 'POST', cookie: alice, json: {
    title: '第二门课', visibility: 'public', stageIds: [stage.id],
  } }, 201)
  const privateCourse = await data('/api/courses', { method: 'POST', cookie: alice, json: {
    title: '私有课程', stageIds: [stage.id],
  } }, 201)
  await data('/api/courses/' + privateCourse.id, { cookie: bob }, 404)
  await data('/api/courses', { method: 'POST', cookie: bob, json: { title: '引用别人的关卡', stageIds: [stage.id] } }, 403)
  await data('/api/stages', { method: 'POST', cookie: alice, json: { title: '独立关卡', task: '创建失败' } }, 405)
  assert.deepEqual((await data('/api/stages', { cookie: bob })).map(item => item.id), [])
  const path = '/api/stages/' + stage.id
  await data(path, { method: 'PUT', cookie: bob, json: {} }, 403)
  await data(path, { method: 'PUT', cookie: alice, json: {
    ...stage, tutorial: '## 练习\n\n{{submit:answer|写下你的答案}}\n\n{{submit:screenshot|上传一张截图}}\n\n{{submit:file|上传你的文件}}',
    visibility: 'private',
  } }, 409)
  for (const answer of ['第一版', '第二版']) {
    const result = await data(path + '/answer', { method: 'PUT', cookie: bob, json: { answer, courseId: first.id } })
    assert.equal(result.stats.answer, 1)
    assert.equal(result.learned, false)
    assert.equal(result.submissions[0].answer, answer)
  }
  for (let i = 0; i < 2; i++) {
    await data(path + '/learned', { method: 'PUT', cookie: bob, json: { learned: true, courseId: first.id } })
  }
  assert.equal((await data('/api/courses/' + first.id, { cookie: bob })).completedCount, 1)
  const reused = await data('/api/courses/' + second.id, { cookie: bob })
  assert.equal(reused.completedCount, 1)
  assert.equal(reused.stages[0].learned, true)
  assert.equal((await data('/api/courses/' + second.id, { cookie: alice })).completedCount, 0)
  const otherUser = await data(path, { cookie: alice })
  assert.deepEqual(otherUser.stats, { learned: 1, answer: 1, screenshot: 0, file: 0, participants: 1 })
  assert.equal(otherUser.learned, false)
  assert.deepEqual(otherUser.submissions, [])
  await data(path + '/learned', { method: 'PUT', cookie: bob, json: { learned: false } })
  assert.equal((await data('/api/courses/' + first.id, { cookie: bob })).completedCount, 0)
  assert.equal((await data('/api/courses?scope=joined', { cookie: bob })).length, 1)
  const library = await data('/api/stages', { cookie: alice })
  assert.deepEqual(library.map(entry => [entry.id, entry.courseCount]), [[stage.id, 3]])
  assert.deepEqual(await data('/api/stages', { cookie: bob }), [])
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
  assert(!listing.result.tools.some(tool => tool.name === 'stage_create'))
  const created = await rpc('tools/call', { name: 'course_create', arguments: {
    title: 'MCP 课程', stageIds: ['step-one', 'step-two'],
    newStages: [
      { clientId: 'step-one', alias: 'setup', title: 'MCP 关卡一', task: '先做这一步', tutorial: '先做这一步\n\n{{submit:answer|写下你的答案}}', methods: ['learned', 'answer'], required: ['answer'] },
      { clientId: 'step-two', title: 'MCP 关卡二', task: '再做这一步', methods: ['learned'] },
    ],
    requires: { 'step-two': ['step-one'] },
  } })
  const course = JSON.parse(created.result.content[0].text)
  assert.equal(course.stages[0].title, 'MCP 关卡一')
  assert.deepEqual(course.stages[0].required, ['answer'])
  assert.deepEqual(course.stages[1].requires, [course.stages[0].id])
  assert.equal(course.visibility, 'private')
  assert.equal((await data('/api/courses?scope=owned', { cookie }))[0].id, course.id)
  const versions = await rpc('tools/call', { name: 'course_versions', arguments: { courseId: course.id } })
  assert.equal(JSON.parse(versions.result.content[0].text).items[0].title, course.title)
  await data('/api/token', { method: 'DELETE', cookie })
  await rpc('tools/call', { name: 'course_list' }, token, 401)
})

test('required submissions gate the learned state everywhere', async () => {
  const owner = await register('requireowner')
  const learner = await register('requirelearner')
  const form = {
    title: '必填关卡', task: '提交答案才能学会',
    tutorial: '## 练习\n\n{{submit:answer|写下你的答案}}\n\n{{submit:file|上传你的文件}}',
    methods: ['learned', 'answer', 'file'], required: ['answer'],
  }
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '必填课程', visibility: 'public', stageIds: ['required-step'],
    newStages: [{ clientId: 'required-step', ...form }],
  } }, 201)
  const [stage] = course.stages
  assert.deepEqual(stage.required, ['answer'])
  assert.deepEqual(stage.missing, ['answer'])
  const path = '/api/stages/' + stage.id
  await data(path + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } }, 409)
  const answered = await data(path + '/answer', { method: 'PUT', cookie: learner, json: { answer: '我的答案', courseId: course.id } })
  assert.deepEqual(answered.missing, [])
  assert.equal(answered.learned, false)
  const learned = await data(path + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } })
  assert.equal(learned.learned, true)
  assert.equal((await data('/api/courses/' + course.id, { cookie: learner })).completedCount, 1)
  assert.equal((await data('/api/courses?scope=joined', { cookie: learner }))[0].completedCount, 1)

  await data(path, { method: 'PUT', cookie: owner, json: { ...form, visibility: 'public', required: ['answer', 'file'] } })
  const stale = await data('/api/courses/' + course.id, { cookie: learner })
  assert.equal(stale.completedCount, 0)
  assert.equal(stale.stages[0].learned, false)
  assert.deepEqual(stale.stages[0].missing, ['file'])
  await data(path, { method: 'PUT', cookie: owner, json: {
    ...form, visibility: 'public', methods: ['learned', 'answer'], required: ['screenshot'],
  } }, 400)
})

test('course labels are author-editable except the featured badge', async () => {
  const owner = await register('labelowner')
  const created = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '标签课程', visibility: 'public', labels: ['draft', 'co-create'], stageIds: [],
  } }, 201)
  assert.deepEqual(created.labels, ['draft', 'co-create'])
  assert.deepEqual((await data('/api/courses', {})).find(course => course.id === created.id).labels, ['draft', 'co-create'])
  const updated = await data('/api/courses/' + created.id, { method: 'PUT', cookie: owner, json: {
    title: '标签课程', visibility: 'public', labels: ['done'], stageIds: [],
  } })
  assert.deepEqual(updated.labels, ['done'])
  const forged = await data('/api/courses/' + created.id, { method: 'PUT', cookie: owner, json: {
    title: '标签课程', visibility: 'public', labels: ['done', 'featured'], stageIds: [],
  } })
  assert.deepEqual(forged.labels, ['done'])
  await data('/api/courses/' + created.id, { method: 'PUT', cookie: owner, json: {
    title: '标签课程', visibility: 'public', labels: ['unknown'], stageIds: [],
  } }, 400)
})

test('stage notes can be public discussions or private notes', async () => {
  const owner = await register('noteowner')
  const reader = await register('notereader')
  const base = '/api/stages/api-setup/notes'
  const created = await data(base, { method: 'POST', cookie: owner, json: { body: '公开的疑问', visibility: 'public' } }, 201)
  const publicNote = created.notes[0]
  assert.equal(publicNote.visibility, 'public')
  assert.equal(publicNote.mine, true)
  const privateList = await data(base, { method: 'POST', cookie: owner, json: { body: '只给我自己看', visibility: 'private' } }, 201)
  assert.equal(privateList.notes.length, 2)
  assert.equal((await data(base, { cookie: reader })).notes.length, 1)
  assert.equal((await data(base)).notes.length, 1)

  const replied = await data(base, { method: 'POST', cookie: reader, json: { body: '我也有这个问题', parentId: publicNote.id } }, 201)
  const withReply = replied.notes.find(note => note.id === publicNote.id)
  assert.equal(withReply.replies.length, 1)
  assert.equal(withReply.replies[0].body, '我也有这个问题')

  const privateNote = privateList.notes.find(note => note.visibility === 'private')
  await data(base, { method: 'POST', cookie: reader, json: { body: '回复私有', parentId: privateNote.id } }, 409)
  await data(base + '/' + publicNote.id, { method: 'DELETE', cookie: reader }, 403)
  await data(base, { method: 'POST', json: { body: '没有登录' } }, 401)
  await data(base, { method: 'POST', cookie: owner, json: { body: '', visibility: 'public' } }, 400)

  await data(base + '/' + publicNote.id, { method: 'PUT', cookie: owner, json: { visibility: 'private' } })
  assert.equal((await data(base, { cookie: reader })).notes.length, 0)
  const detail = await data('/api/stages/api-setup', { cookie: owner })
  assert(detail.notes.some(note => note.body === '只给我自己看'))

  const hidden = (await data(base, { cookie: owner })).notes
  assert.equal(hidden.length, 2)
  await data(base + '/' + hidden[0].id, { method: 'DELETE', cookie: owner })
  assert.equal((await data(base, { cookie: owner })).notes.length, 1)
})

test('submission methods must be placed in the tutorial', async () => {
  const owner = await register('markerowner')
  await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '缺占位', stageIds: ['bare'], newStages: [{
      clientId: 'bare', title: '没有占位的关卡', task: '任务', tutorial: '教程里没有标记', methods: ['learned', 'answer'],
    }],
  } }, 400)
  const placed = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '有占位', stageIds: ['placed'], newStages: [{
      clientId: 'placed', title: '有关卡', task: '任务', tutorial: '## 练习\n\n{{submit:answer|写下你的答案}}', methods: ['learned', 'answer'],
    }],
  } }, 201)
  const detail = await data('/api/stages/' + placed.stages[0].id, { cookie: owner })
  assert.equal(detail.tutorial, '## 练习\n\n{{submit:answer|写下你的答案}}')
})

test('learners can fill small ask fields attached to tutorial steps', async () => {
  const owner = await register('askowner')
  const learner = await register('asklearner')
  const tutorial = '## 第一步\n\n{{ask:你准备做哪一类？|模板,教案,表格}}\n\n{{ask:补充一句}}'
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '提问关卡课程', visibility: 'public', stageIds: ['ask-step'],
    newStages: [{ clientId: 'ask-step', title: '提问关卡', task: '写下你的方向', tutorial, methods: ['learned'] }],
  } }, 201)
  const stageId = course.stages[0].id
  const path = '/api/stages/' + stageId + '/field'
  const saved = await data(path, { method: 'PUT', cookie: learner, json: { field: '你准备做哪一类？', value: '教案' } })
  assert.deepEqual(saved, { field: '你准备做哪一类？', value: '教案' })
  await data(path, { method: 'PUT', cookie: learner, json: { field: '补充一句', value: '先把开学第一周做完' } })
  const detail = await data('/api/stages/' + stageId, { cookie: learner })
  assert.deepEqual(detail.answers.map(item => [item.field, item.value]).sort(),
    [['你准备做哪一类？', '教案'], ['补充一句', '先把开学第一周做完']].sort())
  assert.deepEqual(detail.fieldStats.map(item => [item.field, item.count]).sort(),
    [['你准备做哪一类？', 1], ['补充一句', 1]].sort())
  await data(path, { method: 'PUT', cookie: learner, json: { field: '你准备做哪一类？', value: '修改后的私人回答' } })
  const otherLearner = await register('askotherlearner')
  await data(path, { method: 'PUT', cookie: otherLearner, json: { field: '你准备做哪一类？', value: '另一位学员的私人回答' } })
  await data(path, { method: 'PUT', cookie: otherLearner, json: { field: '不在本课程显示的字段', value: '只供其他讲义使用的回答' } })
  const ownerView = await data('/api/stages/' + stageId, { cookie: owner })
  assert.deepEqual(ownerView.answers, [])
  assert.equal(ownerView.fieldStats.find(item => item.field === '你准备做哪一类？').count, 2)
  assert(!ownerView.fieldStats.some(item => item.field === '不在本课程显示的字段'))
  assert.equal(ownerView.stats.participants, 2)
  await data(path, { method: 'PUT', cookie: learner, json: { field: '补充一句', value: '' } })
  const cleared = await data('/api/stages/' + stageId, { cookie: learner })
  assert.deepEqual(cleared.answers.map(item => item.field), ['你准备做哪一类？'])
  assert(!cleared.fieldStats.some(item => item.field === '补充一句'))
  await data(path, { method: 'PUT', cookie: learner, json: { field: 'a'.repeat(61), value: 'x' } }, 400)
  await data(path, { method: 'PUT', cookie: learner, json: { field: '合法名称', value: 'x'.repeat(2001) } }, 400)
  await data(path, { method: 'PUT', json: { field: '匿名', value: 'x' } }, 401)
})

test('course stage dependencies lock later stages until prerequisites are learned', async () => {
  const owner = await register('depowner')
  const learner = await register('deplearner')
  const stageIds = ['one', 'two', 'three']
  const form = {
    title: '依赖课程', visibility: 'public', stageIds,
    newStages: ['一', '二', '三'].map((name, index) => ({
      clientId: stageIds[index], title: '步骤' + name, task: '步骤' + name + '的任务', methods: ['learned'],
    })),
    requires: { two: ['one'], three: ['one', 'two'] },
  }
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: form }, 201)
  const [first, second, third] = course.stages
  assert.deepEqual(course.stages[1].requires, [first.id])
  assert.deepEqual(course.stages.map(stage => stage.locked), [false, false, false])

  const locked = await data('/api/courses/' + course.id, { cookie: learner })
  assert.deepEqual(locked.stages.map(stage => stage.locked), [false, true, true])

  await data('/api/stages/' + first.id + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } })
  const unlocked = await data('/api/courses/' + course.id, { cookie: learner })
  assert.deepEqual(unlocked.stages.map(stage => stage.locked), [false, false, true])
  assert.equal(unlocked.completedCount, 1)

  const update = { ...form, newStages: undefined, stageIds: [first.id, second.id, third.id], requires: {} }
  await data('/api/courses/' + course.id, { method: 'PUT', cookie: owner, json: {
    ...update, requires: { [first.id]: [second.id] },
  } }, 400)
  await data('/api/courses/' + course.id, { method: 'PUT', cookie: owner, json: {
    ...update, requires: { [second.id]: [second.id] },
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

test('course wishes support discussion, public course links and author-only resolution', async () => {
  const author = await register('wishowner')
  const helper = await register('wishhelper')
  const body = { title: 'SQL 实战课程', goal: '用 SQL 分析数据', approach: '每关用一个真实数据集' }
  await data('/api/wishes', { method: 'POST', json: body }, 401)
  const wish = await data('/api/wishes', { method: 'POST', cookie: author, json: body }, 201)
  const path = '/api/wishes/' + wish.id
  assert.equal(wish.mine, true)
  assert.equal(wish.approach, body.approach)
  assert.equal((await data(path, {})).mine, false)
  const view = await data('/api/view?path=' + encodeURIComponent('/wishes/' + wish.id), {})
  assert.equal(view.view.wish.id, wish.id)
  await data(path + '/replies', { method: 'POST', cookie: helper, json: { body: '可以练习聚合查询。' } }, 201)

  const course = await data('/api/courses', {
    method: 'POST', cookie: helper, json: { title: 'SQL 教程', visibility: 'private', stageIds: [] },
  }, 201)
  const link = () => data(path + '/courses', { method: 'POST', cookie: helper, json: { courseId: course.id } })
  await data(path + '/courses', { method: 'POST', cookie: helper, json: { courseId: course.id } }, 404)
  const visibility = async value => data('/api/courses/' + course.id, {
    method: 'PUT', cookie: helper, json: { title: course.title, visibility: value, stageIds: [] },
  })
  await visibility('public')
  await Promise.all([link(), link()])
  assert.equal((await data(path, {})).courses.length, 1)
  const rate = path + '/courses/' + course.id
  await data(rate, { method: 'PUT', cookie: helper, json: { reaction: 'up' } }, 403)
  await data(path + '/status', { method: 'PUT', cookie: helper, json: { status: 'closed' } }, 403)
  const vote = reaction => data(rate, { method: 'PUT', cookie: author, json: { reaction } })
  assert.equal((await vote('down')).courses[0].reaction, 'down')
  assert.equal((await vote('none')).courses[0].reaction, null)
  assert.equal((await vote('up')).courses[0].reaction, 'up')
  const status = value => data(path + '/status', { method: 'PUT', cookie: author, json: { status: value } })
  const closed = await status('closed')
  assert.equal(closed.status, 'closed')
  assert.equal(closed.replies.items.length, 1)
  assert((await data('/api/wishes?status=closed', {})).items.some(item => item.id === wish.id && item.courseCount === 1))
  assert(!(await data('/api/wishes?status=open', {})).items.some(item => item.id === wish.id))
  await visibility('private')
  assert.equal((await data(path, {})).courses.length, 0)
  await data(rate, { method: 'PUT', cookie: author, json: { reaction: 'down' } }, 404)
  assert.equal((await status('open')).status, 'open')

  const token = (await data('/api/token', { method: 'POST', cookie: author })).token
  const rpc = await data('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, json: {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wish_get', arguments: { wishId: wish.id } },
  } })
  assert.equal(JSON.parse(rpc.result.content[0].text).title, body.title)
})

test('invited editors can collaborate on private courses and restore a complete checkpoint', async () => {
  const [author, editor, reader] = await Promise.all(['courseauthor', 'courseeditor', 'coursereader'].map(register))
  const initial = await data('/api/courses', { method: 'POST', cookie: author, json: {
    title: '协作课程', stageIds: ['private-step', 'public-step'], newStages: [
      { clientId: 'private-step', title: '私有练习', task: '练习任务', tutorial: '初始讲义\n\n{{submit:answer|写下你的答案}}', methods: ['answer'] },
      { clientId: 'public-step', title: '公开练习', task: '练习任务', visibility: 'public' },
    ],
  } }, 201)
  const [privateStage, publicStage] = initial.stages
  const path = '/api/courses/' + initial.id
  const stagePath = '/api/stages/' + privateStage.id
  const scoped = stagePath + '?courseId=' + initial.id
  const view = (suffix, cookie) => data('/api/view?path=' + encodeURIComponent('/course/' + initial.id + suffix), { cookie })
  const update = (cookie, json, status) => data(path, { method: 'PUT', cookie, json }, status)
  const sharing = (cookie, json, status) => data(path + '/sharing', { method: 'PUT', cookie, json }, status)
  const history = cookie => data(path + '/versions', { cookie })
  await data(path, { cookie: editor }, 404)
  await sharing(author, { mode: 'public', editorIds: [], expectedRevision: 0 }, 409)
  const [match] = await data(path + '/sharing/users?q=courseeditor', { cookie: author })
  assert.deepEqual(Object.keys(match).sort(), ['id', 'name', 'username'])
  const shared = await sharing(author, { mode: 'shared', editorIds: [match.id], expectedRevision: 0 })
  assert.equal(shared.visibility, 'private')
  assert.equal((await data('/api/view?path=%2Fowned', { cookie: editor })).view.courses[0].id, initial.id)
  assert.equal((await view('/edit', editor)).view.course.canEdit, true)
  assert.equal((await view('/stage/' + privateStage.id, editor)).view.stage.tutorial, '初始讲义\n\n{{submit:answer|写下你的答案}}')
  assert.equal((await view('/edit', reader)).view.status, 404)
  await data(stagePath, { cookie: editor }, 404)
  await data(scoped, { cookie: reader }, 404)
  await data(path + '/sharing', { cookie: editor }, 403)
  await update(editor, { title: initial.title, visibility: 'public', expectedRevision: shared.revision }, 403)
  await update(editor, { title: initial.title, labels: ['draft'], expectedRevision: shared.revision }, 403)
  await update(editor, { title: '错账号的草稿', expectedEditorId: 'other', expectedRevision: shared.revision }, 409)

  await update(editor, { title: initial.title, stageIds: [privateStage.id, publicStage.id, 'api-setup'], expectedRevision: shared.revision }, 403)
  const beforeRace = { stageIds: [privateStage.id, publicStage.id], expectedRevision: shared.revision }
  const writes = await Promise.all([
    request(path, { method: 'PUT', cookie: author, json: { ...beforeRace, title: '作者保存' } }),
    request(path, { method: 'PUT', cookie: editor, json: { ...beforeRace, title: '协作者保存' } }),
  ])
  assert.deepEqual(writes.map(result => result.status).sort(), [200, 409])
  const winner = await writes.find(result => result.ok).json()
  assert.equal((await history(editor)).items.length, 1)
  const lesson = await data(path + '/stages/' + privateStage.id, { method: 'PUT', cookie: editor, json: {
    title: '本课程专用关卡名', task: '新任务', tutorial: '本课程的新讲义\n\n{{submit:answer|写下你的答案}}', expectedRevision: winner.revision,
  } })
  assert.equal(lesson.course.stages[0].title, '本课程专用关卡名')
  assert.equal((await data(stagePath, { cookie: author })).tutorial, '初始讲义\n\n{{submit:answer|写下你的答案}}')
  await data(stagePath + '/learned', { method: 'PUT', cookie: editor, json: { learned: true, courseId: initial.id } })
  const saved = await update(editor, {
    title: '手动存档', stageIds: [publicStage.id, privateStage.id], checkpoint: true, expectedRevision: lesson.course.revision,
  })
  const { course: expanded, stage: newStage } = await data(path + '/stages', { method: 'POST', cookie: editor, json: {
    title: '后来增加的私有关卡', task: '完成新增任务', expectedRevision: saved.revision,
  } }, 201)
  assert.equal(newStage.owned, false)
  assert.equal(expanded.stages.at(-1).id, newStage.id)
  const versions = await history(editor)
  const baseline = versions.items.find(version => version.revision === 0)
  assert(versions.items.some(version => version.title === '手动存档' && version.reason === 'manual'))
  const restore = path + '/versions/' + baseline.id
  assert.deepEqual((await data(restore, { cookie: editor })).stages.map(stage => stage.id), [privateStage.id, publicStage.id])
  const restored = await data(restore, { method: 'POST', cookie: editor, json: { expectedRevision: expanded.revision } })
  assert.equal(restored.title, initial.title)
  assert.deepEqual(restored.stages.map(stage => stage.id), [privateStage.id, publicStage.id])
  const restoredLesson = await data(scoped, { cookie: editor })
  assert.equal(restoredLesson.tutorial, '初始讲义\n\n{{submit:answer|写下你的答案}}')
  assert.equal(restoredLesson.learned, true)
  const latest = (await history(editor)).items
  assert.equal(latest[0].reason, 'restored')
  assert.equal(latest[1].reason, 'before_restore')
  assert.equal(restored.edit_mode, 'shared')
  await sharing(author, { mode: 'owner', editorIds: [], expectedRevision: restored.revision })
  await data(path, { cookie: editor }, 404)
  await data(scoped, { cookie: editor }, 404)
  await data(restore, { cookie: editor }, 404)
})

test('open collaboration allows signed-in contributors and keeps pre-public history private', async () => {
  const [author, contributor] = await Promise.all(['openauthor', 'opencontributor'].map(register))
  const course = await data('/api/courses', { method: 'POST', cookie: author, json: { title: '私有初稿' } }, 201)
  const path = '/api/courses/' + course.id
  const initial = (await data(path + '/versions', { cookie: author })).items[0]
  const draft = await data(path, { method: 'PUT', cookie: author, json: { title: '公开协作课程', expectedRevision: 0 } })
  const published = await data(path + '/sharing', { method: 'PUT', cookie: author, json: {
    mode: 'public', editorIds: [], expectedRevision: draft.revision,
  } })
  assert.equal(published.visibility, 'public')
  assert.equal((await data(path, {})).canEdit, false)
  await data(path, { method: 'PUT', json: { title: '匿名保存' } }, 401)
  await data(path + '/versions', {}, 401)
  const write = await data(path, { method: 'PUT', cookie: contributor, json: {
    title: '贡献者修改', expectedRevision: published.revision,
  } })
  assert.equal(write.title, '贡献者修改')
  const versions = await data(path + '/versions', { cookie: contributor })
  assert.deepEqual(versions.items.map(item => item.revision), [published.revision])
  await data(path + '/versions/' + initial.id, { cookie: contributor }, 404)
  await data(path + '/versions/' + initial.id, { method: 'POST', cookie: contributor, json: { expectedRevision: write.revision } }, 404)
  await data(path + '/sharing', { method: 'PUT', cookie: author, json: {
    mode: 'owner', editorIds: [], expectedRevision: write.revision,
  } })
  await data(path + '/versions', { cookie: contributor }, 403)
})

test('required courses gate lessons and submissions until all required stages are learned', async () => {
  const [author, student] = await Promise.all(['prereqauthor', 'prereqstudent'].map(register))
  const create = (title, prerequisites, visibility = 'public') => data('/api/courses', {
    method: 'POST', cookie: author, json: {
      title, prerequisites, visibility, stageIds: ['step'],
      newStages: [{ clientId: 'step', title, task: '练习', tutorial: '关卡讲义\n\n{{submit:answer|写下你的答案}}\n\n{{submit:file|上传你的文件}}', methods: ['answer', 'file'] }],
    },
  }, 201)
  const base = await create('基础课')
  const recommended = await create('拓展课')
  const required = courseId => ({ courseId, mode: 'required' })
  const intermediate = await create('进阶课', [required(base.id)])
  const capstone = await create('综合课', [required(intermediate.id), { courseId: recommended.id, mode: 'recommended' }])
  const coursePath = '/api/courses/' + capstone.id
  const stagePath = '/api/stages/' + capstone.stages[0].id
  const scoped = stagePath + '?courseId=' + capstone.id
  const pagePath = `/course/${capstone.id}/stage/${capstone.stages[0].id}`
  const getView = () => data('/api/view?path=' + encodeURIComponent(pagePath), { cookie: student })
  const learned = (course, value = true, status = 200) => data('/api/stages/' + course.stages[0].id + '/learned', {
    method: 'PUT', cookie: student, json: { courseId: course.id, learned: value },
  }, status)
  const blocked = await data(coursePath, { cookie: student })
  assert.equal(blocked.learningLocked, true)
  assert.equal(blocked.stages[0].task, undefined)
  assert.equal((await getView()).view.type, 'course')
  await data(coursePath + '/join', { method: 'POST', cookie: student }, 403)
  await data(scoped, { cookie: student }, 403)
  await data(stagePath, { cookie: student }, 403)
  await learned(capstone, true, 403)
  await data(stagePath + '/answer', { method: 'PUT', cookie: student, json: { answer: '尝试跳过前置项' } }, 403)
  await data(stagePath + '/upload/file?filename=exercise.txt&courseId=' + capstone.id, {
    method: 'PUT', cookie: student, body: '尝试上传',
  }, 403)
  await data(coursePath + '/stages/' + capstone.stages[0].id, { cookie: student }, 403)
  assert.equal((await data(coursePath + '/stages/' + capstone.stages[0].id, { cookie: author })).tutorial,
    '关卡讲义\n\n{{submit:answer|写下你的答案}}\n\n{{submit:file|上传你的文件}}')
  const { token } = await data('/api/token', { method: 'POST', cookie: student })
  const mcp = await data('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, json: {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'stage_get', arguments: { stageId: capstone.stages[0].id } },
  } })
  assert.equal(mcp.result.isError, true)
  await learned(intermediate, true, 403)
  await learned(base)
  await learned(intermediate)
  const eligible = await data(coursePath, { cookie: student })
  assert.equal(eligible.learningLocked, false)
  assert.deepEqual(eligible.prerequisites.map(item => item.completed), [true, false])
  assert.equal((await getView()).view.type, 'stage')
  assert.equal((await data(coursePath + '/join', { method: 'POST', cookie: student })).joined, true)
  await learned(capstone)
  await learned(base, false)
  await data(scoped, { cookie: student }, 403)
})

test('authors can restore prerequisites and cannot introduce cycles or inaccessible public requirements', async () => {
  const author = await register('prereqmanager')
  const required = courseId => ({ courseId, mode: 'required' })
  const create = (title, visibility, prerequisites = []) => data('/api/courses', {
    method: 'POST', cookie: author, json: { title, visibility, prerequisites },
  }, 201)
  const base = await create('私有基础课程', 'private')
  const course = await create('暂存的进阶课程', 'private', [required(base.id)])
  const coursePath = '/api/courses/' + course.id
  const basePath = '/api/courses/' + base.id
  const update = (path, json, status) => data(path, { method: 'PUT', cookie: author, json }, status)
  await update(coursePath, { title: course.title, visibility: 'public', expectedRevision: 0 }, 409)
  await update(basePath, { title: base.title, prerequisites: [required(course.id)], expectedRevision: 0 }, 409)
  await update(basePath, { title: base.title, prerequisites: [required(base.id)], expectedRevision: 0 }, 409)
  const checkpoint = (await data(coursePath + '/versions', { cookie: author })).items[0]
  const stripped = await update(coursePath, { title: course.title, prerequisites: [], expectedRevision: 0 })
  const restored = await data(coursePath + '/versions/' + checkpoint.id, {
    method: 'POST', cookie: author, json: { expectedRevision: stripped.revision },
  })
  assert.deepEqual(restored.prerequisites.map(item => item.courseId), [base.id])
  await update(basePath, { title: base.title, visibility: 'public', expectedRevision: 0 })
  const published = await update(coursePath, { title: course.title, visibility: 'public', expectedRevision: restored.revision })
  assert.equal(published.visibility, 'public')
  await update(basePath, { title: base.title, visibility: 'private', expectedRevision: 1 }, 409)
})

test('inline course settings enforce required answers, isolate reuse, reject stale saves and restore history', async () => {
  const [owner, student] = await Promise.all(['inlineowner', 'inlinestudent'].map(register))
  const initial = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '就地编辑课程', visibility: 'public', stageIds: ['step'], newStages: [{
      clientId: 'step', title: '编辑前', task: '原任务',
      tutorial: '## 原文\n\n{{ask:原问题}}\n\n{{submit:answer|写下你的练习答案}}', methods: ['answer'],
    }],
  } }, 201)
  const stageId = initial.stages[0].id
  const path = '/api/courses/' + initial.id
  const lesson = path + '/stages/' + stageId
  const scoped = '/api/stages/' + stageId + '?courseId=' + initial.id
  const reuse = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '同一关卡复用', visibility: 'public', stageIds: [stageId],
  } }, 201)
  const originalVersion = (await data(path + '/versions', { cookie: owner })).items[0]
  const fields = '/api/stages/' + stageId + '/field'
  await data(fields, { method: 'PUT', cookie: student, json: { field: '原问题', value: '原回答', courseId: initial.id } })
  const payload = {
    title: '直接改后的标题', task: '新任务',
    tutorial: '## 修改过的正文\n\n{{ask:问题改名后|A,B|key=原问题}}\n\n{{submit:answer|补充三条具体的练习答案}}',
    methods: ['learned', 'answer'], required: ['answer'], requiredFields: ['原问题'], expectedRevision: 0,
  }
  await data(lesson, { method: 'PUT', cookie: student, json: payload }, 403)
  const saved = await data(lesson, { method: 'PUT', cookie: owner, json: payload })
  assert.equal(saved.course.revision, 1)
  await data(lesson, { method: 'PUT', cookie: owner, json: payload }, 409)
  const stage = await data(scoped, { cookie: student })
  assert.deepEqual(stage.required, ['answer'])
  assert.deepEqual(stage.requiredFields, ['原问题'])
  assert.deepEqual(stage.missingFields, [])
  assert.equal(stage.answers[0].value, '原回答')
  assert.equal((await data('/api/stages/' + stageId + '?courseId=' + reuse.id, { cookie: student })).title, '编辑前')
  const learnedPath = '/api/stages/' + stageId + '/learned'
  const learn = status => data(learnedPath, { method: 'PUT', cookie: student, json: { learned: true, courseId: initial.id } }, status)
  await learn(409)
  await data('/api/stages/' + stageId + '/answer', { method: 'PUT', cookie: student, json: { answer: '完成练习', courseId: initial.id } })
  await learn(200)
  await data(fields, { method: 'PUT', cookie: student, json: { field: '原问题', value: '', courseId: initial.id } })
  await learn(409)
  const incomplete = await data(path, { cookie: student })
  assert.equal(incomplete.completedCount, 0)
  assert.deepEqual(incomplete.stages[0].missingFields, ['原问题'])
  assert.equal((await data('/api/courses?scope=joined', { cookie: student })).find(course => course.id === initial.id).completedCount, 0)
  await data(lesson, { method: 'PUT', cookie: owner, json: { ...payload, expectedRevision: 1, requiredFields: ['并不存在的问题'] } }, 400)
  const restored = await data(path + '/versions/' + originalVersion.id, {
    method: 'POST', cookie: owner, json: { expectedRevision: 1 },
  })
  assert.equal(restored.stages[0].title, '编辑前')
  const restoredStage = await data(scoped, { cookie: student })
  assert.deepEqual(restoredStage.required, [])
  assert.deepEqual(restoredStage.requiredFields, [])
  assert.equal(restoredStage.submissions[0].answer, '完成练习')
})

test('course aliases are unique, author-managed and resolve course, editor and stage routes', async () => {
  const [owner, collaborator] = await Promise.all(['aliasowner', 'aliaseditor'].map(register))
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '带别名的课程', alias: 'Pan-Baidu', visibility: 'public', stageIds: ['step'],
    newStages: [{ clientId: 'step', title: '短链接关卡', task: '完成关卡' }],
  } }, 201)
  assert.equal(course.alias, 'pan-baidu')
  assert.equal((await data('/api/courses/PAN-BAIDU', {})).id, course.id)
  assert.equal((await data('/api/courses/' + course.id, {})).alias, course.alias)
  const view = (path, cookie) => data('/api/view?path=' + encodeURIComponent(path), { cookie })
  assert.equal((await view('/course/pan-baidu')).view.course.id, course.id)
  assert.equal((await view('/course/pan-baidu/edit', owner)).view.type, 'editor')
  assert.equal((await view('/course/pan-baidu/stage/' + course.stages[0].id)).view.stage.id, course.stages[0].id)
  const account = (await data('/api/me', { cookie: collaborator })).user
  const shared = await data('/api/courses/pan-baidu/sharing', { method: 'PUT', cookie: owner, json: {
    mode: 'shared', editorIds: [account.id], expectedRevision: course.revision,
  } })
  await data('/api/courses/pan-baidu', { method: 'PUT', cookie: collaborator, json: {
    title: course.title, alias: 'steal-alias', expectedRevision: shared.revision,
  } }, 403)
  const renamed = await data('/api/courses/pan-baidu', { method: 'PUT', cookie: owner, json: {
    title: course.title, alias: 'baidu-sharing', expectedRevision: shared.revision,
  } })
  assert.equal(renamed.alias, 'baidu-sharing')
  await data('/api/courses/pan-baidu', {}, 404)
  assert.equal((await data('/api/courses/' + course.id, {})).alias, renamed.alias)
  const baseline = (await data('/api/courses/' + course.id + '/versions', { cookie: owner })).items.find(item => item.revision === 0)
  await data('/api/courses/baidu-sharing/versions/' + baseline.id, { method: 'POST', cookie: owner, json: {
    expectedRevision: renamed.revision,
  } })
  assert.equal((await data('/api/courses/baidu-sharing', {})).alias, renamed.alias)
  const writes = await Promise.all(['alias-contest', 'ALIAS-CONTEST'].map(alias => request('/api/courses', {
    method: 'POST', cookie: owner, json: { title: '竞争别名', alias },
  })))
  assert.deepEqual(writes.map(response => response.status).sort(), [201, 409])
  for (const alias of ['new', 'ai-image', 'contains space', 'slash/name', '-leading', course.id]) {
    const response = await request('/api/courses', { method: 'POST', cookie: owner, json: { title: '无效别名', alias } })
    assert([400, 409].includes(response.status), alias + ' unexpectedly accepted')
  }
  const privateCourse = await data('/api/courses', { method: 'POST', cookie: owner, json: { title: '私有短链接', alias: 'private-alias' } }, 201)
  assert.equal((await view('/course/private-alias', collaborator)).view.status, 404)
  await data('/api/courses/private-alias', { cookie: collaborator }, 404)
  assert.equal((await data('/api/courses/private-alias', { cookie: owner })).id, privateCourse.id)
})

test('step aliases are unique per course, preserve progress and restore with history', async () => {
  const [owner, learner] = await Promise.all(['stepaliasowner', 'stepaliaslearner'].map(register))
  const course = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '步骤短链接', alias: 'step-alias-course', visibility: 'public', stageIds: ['intro', 'bind'],
    newStages: [
      { clientId: 'intro', alias: 'Intro', title: '了解规则', task: '阅读规则' },
      { clientId: 'bind', alias: 'bind', title: '绑定账号', task: '完成绑定' },
    ],
    requires: { bind: ['intro'] },
  } }, 201)
  const [intro, bind] = course.stages
  const base = '/api/courses/' + course.id
  const view = (name, cookie) => data('/api/view?path=' + encodeURIComponent('/course/step-alias-course/stage/' + name), { cookie })
  assert.equal(intro.alias, 'intro')
  const locked = await view('BIND', learner)
  assert.equal(locked.view.stage.id, bind.id)
  assert.equal(locked.view.stage.alias, 'bind')
  assert.equal(locked.view.course.stages[1].locked, true)
  await data('/api/stages/' + intro.id + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } })
  await data('/api/stages/' + bind.id + '/learned', { method: 'PUT', cookie: learner, json: { learned: true, courseId: course.id } })
  const baseline = (await data(base + '/versions', { cookie: owner })).items[0]
  const lesson = { title: bind.title, task: bind.task, tutorial: '', expectedRevision: course.revision }
  await data(base + '/stages/bind', { method: 'PUT', cookie: owner, json: { ...lesson, title: '冲突不应写入', alias: 'INTRO' } }, 409)
  const unchanged = await data(base, { cookie: owner })
  assert.equal(unchanged.revision, course.revision)
  assert.equal(unchanged.stages[1].title, bind.title)
  const renamed = await data(base + '/stages/bind', { method: 'PUT', cookie: owner, json: { ...lesson, alias: 'connect' } })
  assert.equal(renamed.stage.alias, 'connect')
  assert.equal((await view('bind', learner)).view.status, 404)
  assert.equal((await view(bind.id, learner)).view.stage.learned, true)
  assert.equal((await view('connect', learner)).view.stage.id, bind.id)
  assert.equal((await data(base + '/stages/connect', { cookie: owner })).id, bind.id)
  await data(base + '/stages/connect', { method: 'PUT', cookie: learner, json: { ...lesson, alias: 'blocked', expectedRevision: renamed.course.revision } }, 403)
  const reused = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '复用关卡别名', visibility: 'public', stageIds: [bind.id],
  } }, 201)
  const other = await data('/api/courses/' + reused.id + '/stages/' + bind.id, { method: 'PUT', cookie: owner, json: {
    ...lesson, alias: 'connect', expectedRevision: reused.revision,
  } })
  assert.equal(other.stage.alias, 'connect')
  assert.equal((await data(base, { cookie: learner })).stages[1].alias, 'connect')
  const restored = await data(base + '/versions/' + baseline.id, { method: 'POST', cookie: owner, json: {
    expectedRevision: renamed.course.revision,
  } })
  assert.deepEqual(restored.stages.map(stage => stage.alias), ['intro', 'bind'])
  assert.deepEqual(restored.stages[1].requires, [intro.id])
  assert.equal((await view('bind', learner)).view.stage.learned, true)
  assert.equal((await data('/api/courses/' + reused.id, { cookie: owner })).stages[0].alias, 'connect')
  const added = await data(base + '/stages', { method: 'POST', cookie: owner, json: {
    title: '分享结果', task: '提交结果', alias: 'share', expectedRevision: restored.revision,
  } }, 201)
  assert.equal(added.stage.alias, 'share')
  await data(base + '/stages', { method: 'POST', cookie: owner, json: {
    title: '重复步骤', task: '不应创建', alias: 'SHARE', expectedRevision: added.course.revision,
  } }, 409)
  assert.equal((await data(base, { cookie: owner })).stages.length, 3)
  const privateCourse = await data('/api/courses', { method: 'POST', cookie: owner, json: {
    title: '私有步骤别名', alias: 'private-step-alias', stageIds: ['hidden'],
    newStages: [{ clientId: 'hidden', title: '私有', task: '私有内容', alias: 'intro' }],
  } }, 201)
  const denied = await data('/api/view?path=' + encodeURIComponent('/course/private-step-alias/stage/intro'), { cookie: learner })
  assert.equal(denied.view.status, 404)
  assert.equal(privateCourse.stages[0].alias, 'intro')
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

  const featured = await data('/api/admin/courses/ai-image', { method: 'PUT', cookie, json: { featured: true } })
  assert.deepEqual(featured.labels, ['featured'])
  assert.deepEqual((await data('/api/courses/ai-image', {})).labels, ['featured'])
  const adminCourse = await data('/api/courses', { method: 'POST', cookie, json: {
    title: '管理员的课', visibility: 'public', labels: ['done'], stageIds: [],
  } }, 201)
  await data('/api/admin/courses/' + adminCourse.id, { method: 'PUT', cookie, json: { featured: true } })
  const kept = await data('/api/courses/' + adminCourse.id, { method: 'PUT', cookie, json: {
    title: '管理员的课', visibility: 'public', stageIds: [],
  } })
  assert.deepEqual(kept.labels, ['done', 'featured'])
  const dropped = await data('/api/courses/' + adminCourse.id, { method: 'PUT', cookie, json: {
    title: '管理员的课', visibility: 'public', labels: ['done'], stageIds: [],
  } })
  assert.deepEqual(dropped.labels, ['done'])
  await data('/api/admin/courses/ai-image', { method: 'PUT', cookie, json: { featured: false } })
  assert.deepEqual((await data('/api/courses/ai-image', {})).labels, [])

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
