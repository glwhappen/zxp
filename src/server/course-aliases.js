import { fail, requireUser, statement } from './core.js'
import { courseAlias, readableCourse } from './course-access.js'

async function inspectAlias(db, user, alias, excludedId = '') {
  if (!alias) return { alias: null, available: true }
  const conflict = await statement(db, `
    SELECT c.id, c.alias, c.title, c.owner_id,
      CASE WHEN ${readableCourse('?1')} THEN 1 ELSE 0 END AS readable
    FROM courses c WHERE c.id <> ?3 AND (c.alias = ?2 COLLATE NOCASE OR c.id = ?2 COLLATE NOCASE)
    LIMIT 1
  `, user.id, alias, excludedId).first()
  if (!conflict) return { alias, available: true }
  const candidates = Array.from({ length: 8 }, (_, index) => {
    const suffix = '-' + (index + 2)
    return alias.slice(0, 60 - suffix.length).replace(/-+$/, '') + suffix
  })
  const taken = await statement(db, `
    SELECT c.id, c.alias FROM courses c WHERE c.id <> ?1 AND (
      c.id COLLATE NOCASE IN (SELECT value FROM json_each(?2)) OR
      c.alias COLLATE NOCASE IN (SELECT value FROM json_each(?2)))
  `, excludedId, JSON.stringify(candidates)).all()
  const used = new Set(taken.results.flatMap(course => [course.id, course.alias].filter(Boolean).map(value => value.toLowerCase())))
  return {
    alias, available: false, suggestion: candidates.find(value => !used.has(value)) ?? null,
    conflict: conflict.readable ? {
      accessible: true, id: conflict.id, title: conflict.title,
      path: '/course/' + encodeURIComponent(conflict.alias || conflict.id),
      owned: conflict.owner_id === user.id, system: conflict.owner_id === 'workshop-examples',
      usesId: conflict.id.toLowerCase() === alias,
    } : { accessible: false },
  }
}

export async function checkCourseAlias(db, user, value, courseId) {
  const actor = requireUser(user)
  const alias = courseAlias(value)
  let excludedId = ''
  if (courseId) {
    const own = await statement(db, `
      SELECT id FROM courses WHERE owner_id = ?1 AND (id = ?2 OR alias = ?2 COLLATE NOCASE)
    `, actor, courseId).first()
    if (!own) fail(403, '只有作者可以调整课程别名。')
    excludedId = own.id
  }
  return inspectAlias(db, user, alias, excludedId)
}

export async function requireCourseAlias(db, user, alias, courseId) {
  if (!alias) return
  const status = await inspectAlias(db, user, alias, courseId)
  if (status.available) return
  const message = status.conflict.accessible
    ? `这个地址已由「${status.conflict.title}」使用${status.conflict.system ? '（系统示例课程）' : ''}，请换一个别名。`
    : '这个课程地址已被使用，请换一个别名。'
  fail(409, message, { code: 'COURSE_ALIAS_TAKEN', aliasStatus: status })
}
