import { fail, field, requireUser, statement } from './core.js'
import { joinFromStage, readableStage, stageDetail } from './learning.js'

export const FILE_LIMIT = 10 * 1024 * 1024

async function allowSubmission(db, user, stageId, kind) {
  requireUser(user)
  const stage = await readableStage(db, user, stageId)
  if (!stage.methods.includes(kind)) fail(409, '当前关卡未开启这种提交方式。')
}

export async function submitAnswer(db, user, stageId, answer, courseId) {
  await allowSubmission(db, user, stageId, 'answer')
  await statement(db, `
    INSERT INTO submissions (stage_id, user_id, kind, answer)
    VALUES (?, ?, 'answer', ?)
    ON CONFLICT (stage_id, user_id, kind) DO UPDATE
    SET answer = excluded.answer, updated_at = CURRENT_TIMESTAMP
  `, stageId, user.id, field(answer, '答案', 20_000)).run()
  await joinFromStage(db, user, courseId, stageId)
  return stageDetail(db, user, stageId)
}

function imageType(bytes) {
  const matches = (offset, signature) => signature.every((byte, index) => bytes[offset + index] === byte)
  if (matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (matches(0, [255, 216, 255])) return 'image/jpeg'
  if (matches(0, [71, 73, 70, 56])) return 'image/gif'
  if (matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) return 'image/webp'
  fail(400, '截图仅支持 PNG、JPEG、GIF 或 WebP 格式。')
}

async function removeObject(bucket, key) {
  if (!key) return
  try { await bucket.delete(key) } catch (error) { console.error('R2 cleanup failed', error) }
}

export async function submitFile(env, user, stageId, kind, filename, bytes, courseId) {
  const { DB: db, BUCKET: bucket } = env
  await allowSubmission(db, user, stageId, kind)
  if (!bytes.length || bytes.length > FILE_LIMIT) fail(400, '文件大小须大于 0 且不超过 10 MB。')
  filename = field(filename, '文件名', 220).replace(/[\u0000-\u001f\u007f/\\]/g, '_')
  const mime = kind === 'screenshot' ? imageType(bytes) : 'application/octet-stream'
  const previous = await statement(db, `
    SELECT object_key FROM submissions WHERE stage_id = ? AND user_id = ? AND kind = ?
  `, stageId, user.id, kind).first()
  const key = 'submissions/' + crypto.randomUUID()
  await bucket.put(key, bytes)
  try {
    const result = await statement(db, `
      INSERT INTO submissions (stage_id, user_id, kind, object_key, filename, mime_type)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (stage_id, user_id, kind) DO UPDATE SET
        object_key = excluded.object_key, filename = excluded.filename,
        mime_type = excluded.mime_type, updated_at = CURRENT_TIMESTAMP
      WHERE submissions.object_key = ?
    `, stageId, user.id, kind, key, filename, mime, previous?.object_key ?? '').run()
    if (!result.meta.changes) fail(409, '该提交刚被覆盖，请刷新后重试。')
  } catch (error) {
    await removeObject(bucket, key)
    throw error
  }
  await removeObject(bucket, previous?.object_key)
  await joinFromStage(db, user, courseId, stageId)
  return stageDetail(db, user, stageId)
}

export async function downloadFile(env, user, stageId, kind, preview) {
  const id = requireUser(user)
  // Readers may retrieve their own past uploads after a method is disabled.
  const file = await statement(env.DB, `
    SELECT object_key, filename, mime_type FROM submissions WHERE stage_id = ? AND user_id = ? AND kind = ?
  `, stageId, id, kind).first()
  if (!file) fail(404, '没有对应的提交文件。')
  const object = await env.BUCKET.get(file.object_key)
  if (!object) fail(404, '文件不存在，请重试。')
  const name = encodeURIComponent(file.filename.toWellFormed()).replace(/'/g, '%27')
  const disposition = preview && kind === 'screenshot' ? 'inline' : 'attachment'
  return new Response(object.body, { headers: {
    'Cache-Control': 'private, no-store',
    'Content-Type': file.mime_type,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${name}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } })
}
