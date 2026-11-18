import page from '../client/index.html'
import css from '../client/style.css'
import client from 'client-bundle'
import { authenticate, identify, manageToken } from './auth.js'
import { checkOrigin, fail, json, objectBody, readBytes, RequestError, requireUser } from './core.js'
import { seedExamples } from './examples.js'
import {
  courseDetail, joinCourse, listCourses, listStages, markLearned, saveCourse, saveStage, stageDetail,
} from './learning.js'
import { downloadFile, FILE_LIMIT, submitAnswer, submitFile } from './submissions.js'
import { handleMcp } from './mcp.js'

const assets = new Map([
  ['/app.js', [client, 'text/javascript; charset=utf-8']],
  ['/style.css', [css, 'text/css; charset=utf-8']],
])
const security = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
}

async function api(request, env, url) {
  const db = env.DB
  const method = request.method
  if (method !== 'GET') checkOrigin(request)
  const [, , resource, id, action, extra] = url.pathname.split('/')
  if (resource === 'auth' && method === 'POST' && ['register', 'login', 'logout'].includes(id)) {
    return authenticate(request, db, id)
  }
  const user = await identify(request, db)
  if (resource === 'me' && method === 'GET') return json({ user, hosted: SITES_HOSTED })
  if (resource === 'token' && ['POST', 'DELETE'].includes(method)) return json(await manageToken(db, user, method))
  await seedExamples(db)
  if (resource === 'courses') {
    if (method === 'GET') {
      return json(id ? await courseDetail(db, user, id) : await listCourses(db, user, url.searchParams.get('scope') ?? 'public'))
    }
    if (method === 'POST' && id && action === 'join') return json(await joinCourse(db, user, id))
    if ((method === 'POST' && !id) || (method === 'PUT' && id && !action)) {
      requireUser(user)
      return json(await saveCourse(db, user, await objectBody(request), id), id ? 200 : 201)
    }
  }
  if (resource === 'stages') {
    if (method === 'GET' && !action) {
      return json(id ? await stageDetail(db, user, id) : await listStages(db, user, url.searchParams.get('scope') ?? 'available'))
    }
    if ((method === 'POST' && !id) || (method === 'PUT' && id && !action)) {
      requireUser(user)
      return json(await saveStage(db, user, await objectBody(request), id), id ? 200 : 201)
    }
    if (id && method === 'PUT' && (action === 'learned' || action === 'answer')) {
      requireUser(user)
      const data = await objectBody(request)
      const result = action === 'learned' ? await markLearned(db, user, id, data.learned, data.courseId)
        : await submitAnswer(db, user, id, data.answer, data.courseId)
      return json(result)
    }
    if (id && action === 'upload' && ['screenshot', 'file'].includes(extra)) {
      if (method === 'GET') return downloadFile(env, user, id, extra, url.searchParams.get('preview') === '1')
      if (method === 'PUT') {
        requireUser(user)
        const filename = url.searchParams.get('filename') ?? ''
        return json(await submitFile(env, user, id, extra, filename,
          await readBytes(request.body, FILE_LIMIT), url.searchParams.get('courseId')))
      }
    }
  }
  fail(404, '接口不存在。')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/mcp') {
        await seedExamples(env.DB)
        return await handleMcp(request, env)
      }
      if (url.pathname.startsWith('/api/')) return await api(request, env, url)
      if (!['GET', 'HEAD'].includes(request.method)) fail(405, '不支持此请求方法。')
      const [body, type] = assets.get(url.pathname) ?? [page, 'text/html; charset=utf-8']
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        ...security, 'Content-Type': type, 'Cache-Control': 'no-cache',
      } })
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status)
      console.error(error)
      return json({ error: '服务暂时不可用，请稍后重试。' }, 500)
    }
  },
}
