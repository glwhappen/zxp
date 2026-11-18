const cachedTypes = new Set(['explore', 'shelf', 'library', 'course', 'stage'])

export function createViewCache(fetchView, { now = Date.now, limit = 36, freshFor = 45_000, keepFor = 300_000 } = {}) {
  const entries = new Map()
  const pending = new Map()
  let revision = 0
  let identity

  function acceptIdentity(userId) {
    if (identity !== undefined && identity !== userId) invalidate()
    identity = userId
  }

  function read(path) {
    const item = entries.get(path)
    if (!item) return null
    entries.delete(path)
    if (now() - item.savedAt >= keepFor) return null
    entries.set(path, item)
    return { data: structuredClone(item.data), fresh: now() - item.savedAt < freshFor }
  }

  function put(path, data) {
    if (identity !== undefined && (data.profile.user?.id ?? null) !== identity) return
    if (!cachedTypes.has(data.view.type)) {
      entries.delete(path)
      return
    }
    entries.delete(path)
    entries.set(path, { data: structuredClone(data), savedAt: now() })
    if (entries.size > limit) entries.delete(entries.keys().next().value)
  }

  function load(path) {
    const requestedAt = revision
    if (!pending.has(path)) {
      const request = fetchView(path).then(data => {
        if (requestedAt !== revision) return null
        acceptIdentity(data.profile.user?.id ?? null)
        put(path, data)
        return data
      }).finally(() => {
        if (pending.get(path) === request) pending.delete(path)
      })
      pending.set(path, request)
    }
    return pending.get(path).then(data => data && structuredClone(data))
  }

  function invalidate(match = () => true) {
    revision++
    pending.clear()
    for (const [path, item] of entries) {
      if (match(path, item.data.view)) entries.delete(path)
    }
  }

  function update(transform) {
    for (const { data } of entries.values()) transform(data.view)
  }

  return { read, put, load, invalidate, update, acceptIdentity }
}
