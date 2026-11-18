import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createViewCache } from '../src/client/view-cache.js'

const snapshot = (user = 'reader', title = '原版') => ({
  profile: { user: { id: user } },
  view: { type: 'course', course: { title } },
})

test('prefetch and navigation share one request and cached data stays isolated from render state', async () => {
  let calls = 0
  let now = 100
  const cache = createViewCache(async () => { calls++; return snapshot() }, {
    now: () => now, freshFor: 40, keepFor: 300,
  })
  const path = '/course/a'
  const [warm, route] = await Promise.all([cache.load(path), cache.load(path)])
  assert.equal(calls, 1)
  route.view.course.title = '已改'
  assert.equal(warm.view.course.title, '原版')
  assert.equal(cache.read(path).data.view.course.title, '原版')
  assert.equal(cache.read(path).fresh, true)
  now += 41
  assert.equal(cache.read(path).fresh, false)
  now += 300
  assert.equal(cache.read(path), null)
})

test('identity changes remove old pages and invalidated responses cannot repopulate the cache', async () => {
  let resolve
  const cache = createViewCache(() => new Promise(done => { resolve = done }))
  cache.acceptIdentity('owner')
  cache.put('/course/secret', snapshot('owner'))
  const old = cache.load('/course/pending')
  cache.acceptIdentity('other')
  resolve(snapshot('owner'))
  assert.equal(await old, null)
  assert.equal(cache.read('/course/secret'), null)
  assert.equal(cache.read('/course/pending'), null)
  cache.put('/course/secret', snapshot('owner'))
  assert.equal(cache.read('/course/secret'), null)
})
