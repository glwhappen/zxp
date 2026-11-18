import { RequestError, fail } from './core.js'
import { adminApi } from './admin.js'
import { courseDetail, listCourses, listStages, stageDetail } from './learning.js'
import { listWishes, wishDetail } from './wishes.js'

export function profileFor(user, settings) {
  return { user, hosted: SITES_HOSTED, login: { methods: settings.methods, oidcLabel: settings.oidcLabel } }
}

export async function readView(request, env, user, settings, path) {
  try {
    if (!path?.startsWith('/') || path.startsWith('//') || path.length > 450) fail(404, '页面不存在。')
    const [section, id, action, stageId, extra] = path.split('/').filter(Boolean).map(decodeURIComponent)
    const db = env.DB
    if (!section) return { type: 'explore', courses: await listCourses(db, user) }
    if ((section === 'owned' || section === 'learning') && !id) {
      const scope = section === 'owned' ? 'owned' : 'joined'
      return { type: 'shelf', scope, courses: user ? await listCourses(db, user, scope === 'owned' ? 'managed' : scope) : [] }
    }
    if (section === 'stages' && !id) return { type: 'library', stages: await listStages(db, user) }
    if (section === 'wishes' && !action) {
      return id ? { type: 'wish', wish: await wishDetail(db, user, id) }
        : { type: 'wishes', wishes: await listWishes(db) }
    }
    if (section === 'admin' && !id) {
      if (!user) return { type: 'sign-in', message: '登录管理员账号后进入后台。' }
      const url = new URL('/api/admin', request.url)
      const response = await adminApi(request, env, user, settings, url)
      return { type: 'admin', admin: await response.json() }
    }
    if (section === 'course' && ((id === 'new' && !action) || (id && action === 'edit' && !stageId))) {
      if (!user) return { type: 'sign-in', message: '登录后可以创建和编辑课程。' }
      const [course, stages] = await Promise.all([action ? courseDetail(db, user, id) : null, listStages(db, user)])
      if (course && !course.canEdit) fail(403, '当前账号没有课程编辑权限。')
      const allowed = !course || course.owned ? stages : stages.filter(stage => stage.visibility === 'public')
      const available = new Map(allowed.map(stage => [stage.id, stage]))
      for (const stage of course?.stages ?? []) available.set(stage.id, { ...available.get(stage.id), ...stage })
      return { type: 'editor', course, available: [...available.values()] }
    }
    if (section === 'course' && id && !action) return { type: 'course', course: await courseDetail(db, user, id) }
    if (section === 'stage' && id && !action) return { type: 'stage', course: null, stage: await stageDetail(db, user, id) }
    if (section === 'course' && id && action === 'stage' && stageId && !extra) {
      const [course, stage] = await Promise.all([courseDetail(db, user, id), stageDetail(db, user, stageId, id)])
      if (!course.stages.some(item => item.id === stage.id)) fail(404, '这门课程未引用该关卡。')
      return { type: 'stage', course, stage }
    }
    fail(404, '页面不存在。')
  } catch (error) {
    if (error instanceof URIError) return { type: 'error', status: 404, message: '页面不存在。' }
    if (!(error instanceof RequestError)) throw error
    return { type: 'error', status: error.status, message: error.message }
  }
}
