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
import { adminApi } from './admin.js'
import { getLoginSettings } from './login-config.js'
import { beginOidc, finishOidc } from './oidc.js'
import { profileFor, readView } from './views.js'
import { wishApi } from './wishes.js'

const scriptPath = `/assets/app.${CLIENT_DIGEST}.js`
const stylePath = `/assets/style.${CSS_DIGEST}.css`
const renderedPage = page.replace('/app.js', scriptPath).replace('/style.css', stylePath)
const assets = new Map([
  [scriptPath, [client, 'text/javascript; charset=utf-8']],
  [stylePath, [css, 'text/css; charset=utf-8']],
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
  const settings = await getLoginSettings(env)
  if (resource === 'auth' && method === 'POST' && ['register', 'login', 'logout'].includes(id)) {
    return authenticate(request, env, id, settings)
  }
  if (resource === 'auth' && method === 'GET' && id === 'oidc') {
    if (action === 'start') return beginOidc(request, env, settings)
    if (action === 'callback') return finishOidc(request, env, settings)
  }
  const user = await identify(request, env, { settings })
  if (resource === 'me' && method === 'GET') return json(profileFor(user, settings))
  if (resource === 'token' && ['POST', 'DELETE'].includes(method)) return json(await manageToken(db, user, method))
  await seedExamples(db)
  if (resource === 'view' && method === 'GET') {
    const view = await readView(request, env, user, settings, url.searchParams.get('path'))
    return json({ profile: profileFor(user, settings), view })
  }
  if (resource === 'admin') return adminApi(request, env, user, settings, url)
  if (resource === 'wishes') return wishApi(request, db, user, url)
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
      const asset = assets.get(url.pathname)
      if (!asset && url.pathname.startsWith('/assets/')) fail(404, '资源版本已更新，请刷新页面。')
      const [body, type] = asset ?? [renderedPage, 'text/html; charset=utf-8']
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        ...security, 'Content-Type': type, 'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-cache',
      } })
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status)
      console.error(error)
      return json({ error: '服务暂时不可用，请稍后重试。' }, 500)
    }
  },
}
