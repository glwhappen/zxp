import assert from 'node:assert/strict'
import test from 'node:test'
import { createCourseAutosave } from '../src/client/course-autosave.js'

test('autosave collects drafts and serializes edits made during a save', async () => {
  const sent = []
  const { promise, resolve } = Promise.withResolvers()
  const autosave = createCourseAutosave({
    delay: 1000, status() {},
    async send(key, draft) {
      sent.push([key, draft])
      if (sent.length === 1) await promise
    },
  })
  autosave.remember('course', { title: '原始' })
  autosave.queue('course', { title: '第一笔' })
  autosave.queue('course', { title: '停笔时的草稿' })
  const saving = autosave.flush()
  autosave.queue('course', { title: '保存期间的新改动' })
  autosave.queue('lesson', { tutorial: '课程讲义' })
  assert.deepEqual(sent, [['course', { title: '停笔时的草稿' }]])
  const flushed = autosave.flush()
  resolve()
  assert.equal(await saving, true)
  assert.equal(await flushed, true)
  assert.deepEqual(sent.slice(1), [
    ['course', { title: '保存期间的新改动' }], ['lesson', { tutorial: '课程讲义' }],
  ])
  assert.equal(autosave.dirty(), false)
})

test('autosave preserves the draft after a revision conflict', async () => {
  const states = []
  let writes = 0
  const autosave = createCourseAutosave({
    status: (message, kind) => states.push(kind),
    send() {
      writes++
      throw Object.assign(new Error('课程刚被更新。'), { status: 409 })
    },
  })
  autosave.queue('course', { title: '草稿' })
  assert.equal(await autosave.flush(), false)
  assert.equal(states.at(-1), 'conflict')
  autosave.queue('course', { title: '修改后的草稿' })
  assert.equal(await autosave.flush(), false)
  assert.equal(writes, 1)
  assert.equal(autosave.dirty(), true)
  assert.deepEqual(autosave.draft('course'), { title: '修改后的草稿' })
  autosave.discard()
  assert.equal(autosave.dirty(), false)
})

test('correcting an invalid alias clears the save error, including a return to the saved value', async () => {
  for (const corrected of ['available', 'original']) {
    const states = []
    const writes = []
    const autosave = createCourseAutosave({
      delay: 10_000,
      status: (message, kind) => states.push({ message, kind }),
      async send(key, draft) {
        writes.push(draft.alias)
        if (draft.alias === 'ai-video') throw Object.assign(new Error('课程别名已被使用。'), { status: 409 })
      },
    })
    autosave.remember('course', { alias: 'original' })
    autosave.queue('course', { alias: 'ai-video' })
    assert.equal(await autosave.flush(), false)
    assert.equal(states.at(-1).kind, 'error')
    autosave.queue('course', { alias: corrected })
    assert.equal(states.at(-1).kind, undefined)
    assert.equal(await autosave.flush(), true)
    assert.deepEqual(states.at(-1), { message: '已保存', kind: undefined })
    assert.deepEqual(writes, corrected === 'original' ? ['ai-video'] : ['ai-video', 'available'])
    autosave.discard()
  }
})

test('a late alias rejection cannot replace the status of a newer valid draft', async () => {
  const pending = Promise.withResolvers()
  const states = []
  const writes = []
  const autosave = createCourseAutosave({
    status: (message, kind) => states.push({ message, kind }),
    async send(key, draft) {
      writes.push(draft.alias)
      if (draft.alias === 'ai-video') await pending.promise
    },
  })
  autosave.queue('course', { alias: 'ai-video' })
  const saving = autosave.flush()
  autosave.queue('course', { alias: 'ai-wx-video' })
  pending.reject(Object.assign(new Error('旧的别名冲突。'), { status: 409 }))
  assert.equal(await saving, true)
  assert.deepEqual(writes, ['ai-video', 'ai-wx-video'])
  assert.equal(states.some(state => state.kind === 'error'), false)
  assert.equal(states.at(-1).message, '已保存')
  autosave.discard()
})
