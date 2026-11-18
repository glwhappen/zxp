export function createCourseAutosave({ send, status, delay = 850 }) {
  const baseline = new Map()
  const drafts = new Map()
  let timer
  let running
  let activeKey
  let conflicted = false
  let disposed = false

  function remember(key, data) {
    if (!drafts.has(key)) baseline.set(key, JSON.stringify(data))
  }

  function queue(key, data) {
    if (disposed) return
    const signature = JSON.stringify(data)
    if (baseline.get(key) === signature && activeKey !== key) drafts.delete(key)
    else drafts.set(key, { data, signature })
    clearTimeout(timer)
    if (conflicted) return
    status(drafts.size ? '待保存…' : '已保存')
    if (drafts.size) timer = setTimeout(() => flush(), delay)
  }

  async function drain() {
    while (drafts.size && !disposed && !conflicted) {
      const [key, draft] = drafts.entries().next().value
      if (draft.signature === baseline.get(key)) {
        drafts.delete(key)
        continue
      }
      activeKey = key
      status('正在自动保存…')
      try {
        await send(key, draft.data)
        baseline.set(key, draft.signature)
        if (drafts.get(key) === draft) drafts.delete(key)
      } catch (error) {
        conflicted = error.status === 409 && error.message.includes('课程刚被更新')
        if (!conflicted && drafts.get(key) !== draft) continue
        if (!disposed) status(conflicted ? '有人保存了新版本。当前草稿已保留。' : error.message, conflicted ? 'conflict' : 'error')
        return false
      } finally {
        activeKey = undefined
      }
    }
    if (!disposed && !conflicted) status('已保存')
    return !drafts.size && !conflicted
  }

  function flush() {
    clearTimeout(timer)
    if (disposed || conflicted) return Promise.resolve(false)
    if (!running) running = drain().finally(() => { running = undefined })
    return running
  }

  function discard() {
    disposed = true
    clearTimeout(timer)
    drafts.clear()
  }

  return {
    remember, queue, flush, discard,
    draft: key => drafts.get(key)?.data,
    dirty: () => !disposed && (drafts.size > 0 || Boolean(activeKey)),
  }
}
