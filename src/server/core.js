export class RequestError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function fail(status, message, details) {
  throw new RequestError(status, message, details)
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export function field(value, label, max, required = true) {
  if (typeof value !== 'string') fail(400, `${label}必须是文本。`)
  const result = value.trim()
  if (required && !result) fail(400, `请填写${label}。`)
  if (result.length > max) fail(400, `${label}最多 ${max} 个字符。`)
  return result
}

export function choice(value, allowed, label) {
  if (!allowed.includes(value)) fail(400, `${label}无效。`)
  return value
}

export function requireUser(user) {
  if (!user) fail(401, '请先登录。')
  return user.id
}

export function checkOrigin(request) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) fail(403, '请求来源无效。')
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, '请求来源无效。')
}

export async function objectBody(request, max = 150_000) {
  let value
  try {
    const body = await readBytes(request.body, max)
    value = JSON.parse(new TextDecoder().decode(body))
  } catch (error) {
    if (error instanceof RequestError) throw error
    fail(400, 'JSON 格式无效。')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求内容必须是 JSON 对象。')
  return value
}

export async function readBytes(stream, max) {
  if (!stream) fail(400, '请求内容为空。')
  const parts = []
  const reader = stream.getReader()
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > max) {
        await reader.cancel()
        fail(413, '提交内容超过大小限制。')
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

export function statement(db, sql, ...params) {
  return db.prepare(sql).bind(...params)
}

export async function rows(query) {
  return (await query.all()).results
}
