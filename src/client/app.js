import { icon } from './icons.js'
import { adminPage, providerNames } from './admin.js'
import { createViewCache } from './view-cache.js'
import { hasSubmissionMarker, submissionKinds, submissionMarker } from './tutorial.js'
import {
  button, card, categories, courseEditor, coursePage, coursePath, esc, hero, key, link, note, outline,
  pickedStages, progress, stageEditor, stagePage, stagePath, stageStats, submission, visibility,
} from './views.js'

const main = document.querySelector('#main')
const sidebar = document.querySelector('#sidebar')
const topbar = document.querySelector('#topbar')
const dialog = document.querySelector('#dialog')
const toast = document.querySelector('#toast')
const navigationProgress = document.querySelector('#navigation-progress')
const productName = '知行谱'
const state = { user: null, hosted: false, login: { methods: {} }, path: '', category: '', query: '', current: null, editor: null }
let navigation = 0
let toastTimeout
let shellIdentity
let identityRevision = 0
const views = createViewCache(path => api('view?path=' + key(path)))
const accountEvents = typeof BroadcastChannel === 'function' ? new BroadcastChannel('zxp-account') : null

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function api(path, options = {}) {
  const res = await fetch('/api/' + path, {
    method: options.method ?? 'GET',
    body: options.file ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? '服务暂时不可用，请重试。')
  return data
}

async function refreshIdentity() {
  const revision = identityRevision
  const profile = await api('me')
  if (revision === identityRevision) applyProfile(profile)
}

function applyProfile(profile) {
  views.acceptIdentity(profile.user?.id ?? null)
  Object.assign(state, profile)
}

function cachePage(path, view) {
  views.put(path, { view, profile: { user: state.user, hosted: state.hosted, login: state.login } })
}

function accountChanged() {
  identityRevision++
  views.invalidate()
  accountEvents?.postMessage('changed')
}

function announce(message, error = false) {
  toast.className = error ? 'toast error' : 'toast'
  toast.innerHTML = `${icon(error ? 'close' : 'check', 16)} ${esc(message)}`
  clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => { toast.className = ''; toast.replaceChildren() }, 4200)
}

function showDialog(title, body, wide = false) {
  dialog.className = wide ? 'dialog-wide' : ''
  dialog.innerHTML = `<div class="dialog-top"><h2 id="dialog-title">${esc(title)}</h2>
    ${button('close', '', 'icon-btn', 'close', 'aria-label="关闭"')}</div><div class="dialog-body">${body}</div>`
  if (!dialog.open) dialog.showModal()
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 部分浏览器/非安全上下文下 Clipboard API 不可用，退回选中复制
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const done = document.execCommand('copy')
    area.remove()
    return done
  }
}

// 一份可直接粘贴的 MCP 配置，Authorization 头已带上刚生成的令牌。
function mcpConfigHtml(token) {
  const config = JSON.stringify({
    mcpServers: {
      zxp: { type: 'http', url: location.origin + '/mcp', headers: { Authorization: 'Bearer ' + token } },
    },
  }, null, 2)
  const command = `claude mcp add --transport http zxp ${location.origin}/mcp --header "Authorization: Bearer ${token}"`
  return `<div class="mcp-config">
    <p class="subtle">把下面这份配置粘进支持远程 MCP 的客户端（Claude Code、Cursor 等），鉴权头已经带上令牌。</p>
    <textarea class="config-block" readonly rows="9" aria-label="MCP 客户端配置" data-mcp-config>${esc(config)}</textarea>
    <div class="inline-actions">${button('copy-config', '复制配置', 'btn primary', 'file')}</div>
    <details class="mcp-more"><summary>命令行接入（Claude Code）</summary>
      <textarea class="config-block" readonly rows="3" aria-label="Claude Code 命令" data-mcp-command>${esc(command)}</textarea>
      <div class="inline-actions">${button('copy-command', '复制命令', 'btn', 'plug')}</div>
    </details>
    <p class="subtle">令牌只在这次生成时显示，关掉就需要重新生成；轮换后旧令牌立即失效。</p>
  </div>`
}

function login(mode = 'login') {
  const { methods, oidcLabel } = state.login
  const returnTo = key(/^\/(?!\/)/.test(location.pathname) ? location.pathname + location.search : '/')
  const providers = `<div class="login-providers">
    ${methods.chatgpt ? `<a class="btn" href="/signin-with-chatgpt?return_to=${returnTo}" target="_top">使用 ChatGPT 登录</a>` : ''}
    ${methods.oidc ? `<a class="btn ${methods.password ? '' : 'primary'}" href="/api/auth/oidc/start?return_to=${returnTo}" target="_top">${esc(oidcLabel)}</a>` : ''}
  </div>`
  const hasProviders = methods.chatgpt || methods.oidc
  const register = mode === 'register'
  showDialog(register ? '创建账号' : `登录${productName}`, `
    ${hasProviders ? providers : ''}
    ${methods.password ? `<form data-form="auth" data-mode="${mode}">
    ${register ? '<label>昵称<input name="name" maxlength="40" autocomplete="nickname" required></label>' : ''}
    <label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="32" required></label>
    <label>密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" required></label>
    <div class="form-error" role="alert" hidden></div><div class="submit-row">
      ${button(register ? 'login' : 'register', register ? '已有账号，去登录' : '没有账号，去注册', 'text-btn')}
      <button class="btn primary">${register ? '注册' : '登录'}</button></div></form>` : ''}
    ${!hasProviders && !methods.password ? '<p>当前没有可用的登录方式。请联系站点管理员。</p>' : ''}`)
  dialog.querySelector('input')?.focus()
}

function requireLogin() {
  if (state.user) return true
  login()
  return false
}

function account() {
  if (!requireLogin()) return
  const alternatives = Object.keys(state.login.methods).some(key => state.login.methods[key] && key !== state.user.provider)
  showDialog('我的账号', `<p class="account-name"><span class="avatar">${esc(state.user.name.slice(0, 1))}</span> ${esc(state.user.name)}</p>
    <p class="subtle">${esc(providerNames[state.user.provider])} · 账号 ID <code>${esc(state.user.id)}</code></p>
    ${state.user.oidcSubject ? `<p class="subtle account-id">OIDC Subject <code>${esc(state.user.oidcSubject)}</code></p>` : ''}
    <div class="inline-actions">${state.user.isAdmin ? link('/admin', '管理后台', 'btn', 'lock') : ''}
      ${alternatives ? button('login', '切换登录方式') : ''}
      ${state.user.provider === 'chatgpt' ? '<a class="btn" href="/signout-with-chatgpt?return_to=%2F" target="_top">退出登录</a>'
        : button('logout', '退出登录')}</div>`)
}

function showMcp() {
  if (state.hosted) {
    showDialog('MCP 连接', `<p>在 ChatGPT 或 Codex 的「插件 → 个人 → 由你创建」中连接${productName}。</p>
      <p>让助手先列出关卡，再为你创建课程。例如：</p>
      <blockquote>列出我创建的关卡，把「配置大模型 API」加入一门叫「AI 视频练习」的私有课程。</blockquote>`)
    return
  }
  showDialog('MCP 连接', `<p>让外部助手（Claude Code、Cursor、Codex 等）通过 MCP 访问你在${productName}的课程、关卡和提交记录。</p>
    <label>MCP 地址<input readonly value="${esc(location.origin)}/mcp"></label>
    <div class="inline-actions">${button('token', '生成令牌并复制配置', 'btn primary', 'plug')}${button('revoke', '撤销令牌')}</div>
    <p class="subtle">每点一次都会生成新令牌，之前复制出去的配置随之失效。</p>
    <div data-token-result></div>`)
}

function activeNav() {
  return state.path === '/' || /^\/course\/[^/]+(?:\/stage\/[^/]+)?$/.test(state.path)
    ? '/' : state.path.startsWith('/stage/') ? '/stages'
      : state.path.startsWith('/course/') ? '/owned' : state.path
}

function paintShell() {
  const identity = JSON.stringify([state.user?.id, state.user?.name, state.user?.isAdmin])
  const active = activeNav()
  if (identity === shellIdentity) {
    for (const item of sidebar.querySelectorAll('nav a')) {
      const selected = item.pathname === active
      item.classList.toggle('active', selected)
      if (selected) item.setAttribute('aria-current', 'page')
      else item.removeAttribute('aria-current')
    }
    const menu = topbar.querySelector('[data-action="menu"]')
    menu?.setAttribute('aria-expanded', String(document.body.classList.contains('menu-open')))
    const search = topbar.querySelector('input[name="query"]')
    if (search && search.value !== state.query) search.value = state.query
    return
  }
  shellIdentity = identity
  const sections = [
    ['学习', [['/', '探索课程', 'compass'], ['/learning', '我的学习', 'book']]],
    ['创作', [['/owned', '我的创作', 'grid'], ['/stages', '我的关卡', 'layers']]],
  ]
  if (state.user?.isAdmin) sections.push(['管理', [['/admin', '管理后台', 'lock']]])
  sidebar.innerHTML = `<a class="brand" href="/" data-link><span class="brand-icon">${icon('logo', 23)}</span>
    <span><strong>${productName}</strong><small>ZXP</small></span></a>
    <nav aria-label="主要导航">${sections.map(([heading, links]) => `<div class="nav-group"><div class="nav-title">${heading}</div>
      ${links.map(([url, label, symbol]) => `<a class="nav-link ${active === url ? 'active' : ''}" href="${url}" data-link
        ${active === url ? 'aria-current="page"' : ''}>${icon(symbol, 19)}${label}</a>`).join('')}</div>`).join('')}</nav>
    <div class="sidebar-bottom">${button('mcp', 'MCP 连接', 'nav-link', 'plug')}</div>`
  topbar.innerHTML = `<div class="topbar-content">
    ${button('menu', '', 'icon-btn mobile-menu', 'menu', 'aria-label="打开主导航" aria-expanded="false" aria-controls="sidebar"')}
    <form class="search-box" role="search" data-form="search">${icon('search', 19)}
      <input name="query" type="search" aria-label="搜索课程" placeholder="搜索课程…" value="${esc(state.query)}"></form>
    <div class="top-actions">${button('create-course', '创建课程', 'btn primary create-course', 'plus')}
      ${state.user ? button('account', `<span class="avatar">${esc(state.user.name.slice(0, 1))}</span><span class="account-label">${esc(state.user.name)}</span>`, 'account-btn')
        : button('login', '登录', 'btn login-btn', 'user')}</div>
  </div>`
}

function paintExplore(courses) {
  const featured = courses.find(course => course.id === 'ai-image')
  main.innerHTML = `<div class="page-heading"><h1>探索课程</h1><p>选一项想学的技能，跟着实战关卡一步步练习。</p></div>
    ${featured ? hero(featured) : ''}
    <section class="catalog" aria-labelledby="catalog-title">
      <div class="section-head"><h2 id="catalog-title">所有课程</h2><span class="subtle" data-course-count></span></div>
      <div class="filter-row" role="group" aria-label="按分类筛选">
        ${['', ...categories.filter(category => courses.some(course => course.category === category))].map(category =>
          button('category', esc(category || '全部'), 'filter', null,
            `aria-pressed="${state.category === category}" data-category="${esc(category)}"`)).join('')}
      </div><div data-results></div>
    </section>`
  const feature = main.querySelector('.hero')
  if (feature) feature.hidden = Boolean(state.query)
  paintResults(courses)
}

function paintResults(courses) {
  const query = state.query.trim().toLowerCase()
  const result = courses.filter(course => (!state.category || course.category === state.category)
    && (!query || [course.title, course.description, course.category].some(value => value.toLowerCase().includes(query))))
  main.querySelector('[data-course-count]').textContent = `${result.length} 门课程`
  main.querySelector('[data-results]').innerHTML = result.length
    ? '<div class="catalog-grid">' + result.map(course => card(course, 'public')).join('') + '</div>'
    : note('没有找到符合条件的课程。', 'search')
}

function courseShelf(courses, scope) {
  const own = scope === 'owned'
  const action = own ? button('create-course', '创建课程', 'btn primary', 'plus') : link('/', '探索课程', 'btn primary', 'compass')
  main.innerHTML = `<div class="page-heading section-head"><div><h1>${own ? '我的创作' : '我的学习'}</h1>
    <p>${own ? '管理你创建的课程，随时编辑内容或公开分享。' : '继续已加入的课程，查看跨课程同步的关卡进度。'}</p></div>${action}</div>
    ${!state.user ? `<div class="sign-in-panel">${note('登录后查看你的课程。', 'lock')}${button('login', '登录')}</div>`
      : courses.length ? `<div class="catalog-grid">${courses.map(course => card(course, scope)).join('')}</div>`
        : note(own ? '你还没有创建课程。' : '加入一门课程，或完成任意关卡提交，开始记录你的学习。')}`
}

function stagesPage(stages) {
  if (!state.user) {
    main.innerHTML = `<div class="sign-in-panel">${note('登录后管理你的关卡。', 'lock')}${button('login', '登录', 'btn primary')}</div>`
    return
  }
  main.innerHTML = `<div class="page-heading section-head"><div><h1>我的关卡</h1>
    <p>你创建的可复用关卡：放进自己的多门课程时，学习记录会同步。新建和编辑都在课程编辑器里做。</p></div>
    ${link('/owned', '去我的创作', 'btn', 'grid')}</div>
    <div class="stage-grid">${stages.map(stage => `<a class="library-stage" data-link href="${stagePath(stage.id)}">
      <span class="library-icon">${icon('layers', 22)}</span><span class="step-text"><strong>${esc(stage.title)}</strong>
      <small>${esc(stage.task)}</small>
      <small>${stage.visibility === 'public' ? '公开' : '私有'} · ${stage.courseCount ? `被 ${stage.courseCount} 门课程引用` : '还没有课程引用'} · ${stage.learnedCount} 人学会</small></span>
      ${icon('arrow', 16)}</a>`).join('') || note('还没有关卡。到「我的创作」编辑课程，点「新建关卡」创建后就能在其他课程里引用。')}</div>`
}

function paintView({ profile, view }, path) {
  applyProfile(profile)
  state.path = path
  state.current = null
  state.editor = null
  document.body.classList.remove('menu-open')
  if (dialog.open) dialog.close()
  paintShell()
  switch (view.type) {
    case 'explore':
      state.current = { courses: view.courses }
      paintExplore(view.courses)
      break
    case 'shelf': courseShelf(view.courses, view.scope); break
    case 'library': stagesPage(view.stages); break
    case 'editor':
      state.editor = {
        course: view.course, available: view.available,
        ids: view.course?.stages.map(stage => stage.id) ?? [],
        requires: Object.fromEntries((view.course?.stages ?? []).map(stage => [stage.id, stage.requires ?? []])),
      }
      main.innerHTML = courseEditor(state.editor)
      break
    case 'course':
      state.current = { course: view.course }
      main.innerHTML = coursePage(view.course, state.user)
      break
    case 'stage':
      state.current = { course: view.course, stage: view.stage, userId: state.user?.id }
      if (view.course && !views.read(coursePath(view.course.id))) {
        cachePage(coursePath(view.course.id), { type: 'course', course: view.course })
      }
      main.innerHTML = stagePage(view.stage, view.course, view.course?.stages.find(item => item.id === view.stage.id))
      break
    case 'admin':
      state.current = { admin: view.admin }
      main.innerHTML = adminPage(view.admin)
      break
    case 'sign-in':
      main.innerHTML = `<div class="sign-in-panel">${note(view.message, 'lock')}${button('login', '登录', 'btn primary')}</div>`
      break
    case 'error':
      main.innerHTML = `<div class="sign-in-panel">${note(view.message, 'close')}${link('/', '返回课程首页')}</div>`
      break
  }
  document.title = `${main.querySelector('h1')?.textContent ?? '学习'} · ${productName}`
}

function warmView(path) {
  if (navigator.connection?.saveData || !path || path === state.path || views.read(path)?.fresh) return
  if (!/^\/(?:learning|owned|stages|stage\/[^/]+|course\/(?!new$)[^/]+(?:\/stage\/[^/]+)?)?$/.test(path)) return
  views.load(path).catch(() => {})
}

function warmNext(view, version) {
  if (!view.course?.stages.length) return
  const stages = view.course.stages
  const index = view.stage ? stages.findIndex(stage => stage.id === view.stage.id) : -1
  const next = view.stage
    ? stages[index + 1] : stages.find(stage => !stage.learned) ?? stages[0]
  if (!next) return
  setTimeout(() => {
    if (version === navigation) warmView(stagePath(next.id, view.course))
  }, 120)
}

function refreshView(path, version) {
  views.load(path).then(data => {
    if (!data || version !== navigation || path !== state.path) return
    const identityChanged = state.user?.id !== data.profile.user?.id
    if (identityChanged || data.view.type === 'error') {
      paintView(data, path)
    } else if (['explore', 'shelf', 'library'].includes(data.view.type) && !dialog.open &&
      !main.contains(document.activeElement)) {
      paintView(data, path)
    } else {
      applyProfile(data.profile)
      paintShell()
    }
  }).catch(() => {})
}

async function navigate(path = location.pathname, push = false, focus = false) {
  const version = ++navigation
  const cached = views.read(path)
  navigationProgress.hidden = true
  const showProgress = !cached && setTimeout(() => {
    if (version === navigation) navigationProgress.hidden = false
  }, 130)
  try {
    let data = cached?.data
    while (!data && version === navigation) data = await views.load(path)
    if (version !== navigation) return
    if (push && path !== location.pathname) history.pushState({}, '', path)
    paintView(data, path)
    window.scrollTo(0, 0)
    if (focus) main.focus({ preventScroll: true })
    if (cached && !cached.fresh) refreshView(path, version)
    warmNext(data.view, version)
  } catch (error) {
    if (version !== navigation) return
    if (state.path && push) announce(error.message, true)
    else main.innerHTML = `<div class="sign-in-panel">${note(error.message, 'close')}${button('retry-view', '重试')}</div>`
  } finally {
    clearTimeout(showProgress)
    if (version === navigation) navigationProgress.hidden = true
  }
}

function paintPicked() {
  main.querySelector('[data-picked-stages]').innerHTML = pickedStages(state.editor)
}

// 关卡顺序变化后，丢掉不再排在前面或已被移除的依赖，避免保存时被服务端拒绝。
function pruneRequires() {
  const { ids, requires } = state.editor
  const position = new Map(ids.map((id, index) => [id, index]))
  for (const [stageId, deps] of Object.entries(requires)) {
    if (!position.has(stageId)) {
      delete requires[stageId]
      continue
    }
    requires[stageId] = deps.filter(dep => position.has(dep) && position.get(dep) < position.get(stageId))
  }
}

function recomputeLocks(course) {
  const byId = new Map(course.stages.map(stage => [stage.id, stage]))
  course.stages.forEach(stage => {
    stage.locked = !course.owned && !stage.learned
      && (stage.requires ?? []).some(id => !byId.get(id)?.learned)
  })
}

function requiresDialog(stageId) {
  const { ids, requires } = state.editor
  const titles = new Map(state.editor.available.map(stage => [stage.id, stage.title]))
  const chosen = new Set(requires[stageId] ?? [])
  const candidates = ids.slice(0, ids.indexOf(stageId))
  showDialog('设置前置关卡', candidates.length ? `<form data-form="requires" data-stage="${esc(stageId)}">
    <p class="subtle">勾选的关卡全部学会后，学习者才能打开当前关卡。</p>
    <div class="stage-options">${candidates.map(id => `<label class="stage-option"><input type="checkbox" name="deps" value="${esc(id)}" ${chosen.has(id) ? 'checked' : ''}>
      <span class="step-text"><strong>${esc(titles.get(id) ?? id)}</strong></span></label>`).join('')}</div>
    <div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">保存依赖</button></div>
  </form>` : '<p class="subtle">当前关卡排在第一位，没有可以作为前置的关卡。</p>')
}

function chooseStageDialog() {
  const entries = state.editor.available.filter(stage => !state.editor.ids.includes(stage.id))
  showDialog('引用已有的关卡', `<label>搜索关卡<input type="search" placeholder="输入名称或作者" data-stage-filter></label>
    <p class="subtle">只能引用你自己创建的关卡；同一个关卡在多门课程里共用学会状态和提交记录。</p>
    <div class="stage-options">${entries.map(stage => `<button type="button" class="stage-option" data-action="attach-stage" data-id="${esc(stage.id)}">
      <span class="step-text"><strong>${esc(stage.title)}</strong><small>${esc(stage.author)}</small></span>
      ${visibility(stage.visibility)}${icon('plus', 17)}</button>`).join('') || note('你还没有其他可以引用的关卡，先在课程里新建一个。')}</div>`, true)
}

function syncCourseProgress(course, stage, joinedCourseId) {
  const step = course?.stages.find(item => item.id === stage.id)
  if (!step) return
  step.learned = stage.learned
  course.completedCount = course.stages.filter(item => item.learned).length
  if (course.id === joinedCourseId && !course.joined) {
    course.joined = true
    course.learnerCount++
  }
}

// 必填项与前置依赖会随提交或撤销变化，同步到缓存视图里的同一关卡和整门课。
function syncStageRules(course, stage) {
  const entry = course?.stages.find(item => item.id === stage.id)
  if (!entry) return
  Object.assign(entry, { required: stage.required, missing: stage.missing })
  recomputeLocks(course)
}

function applyStage(stage, kind, context) {
  if (context.userId !== state.user?.id) return
  const joinedCourseId = kind !== 'learned' || stage.learned ? context.course?.id : null
  const changesEnrollment = joinedCourseId && !context.course.joined
  views.invalidate((path, view) => (view.type === 'shelf' && (view.scope === 'joined' || changesEnrollment))
    || (changesEnrollment && view.type === 'explore'))
  views.update(view => {
    if (view.stage?.id === stage.id) view.stage = stage
    syncCourseProgress(view.course, stage, joinedCourseId)
    syncStageRules(view.course, stage)
  })
  if (context !== state.current) return
  context.stage = stage
  main.querySelector('[data-stage-stats]').innerHTML = stageStats(stage)
  const slot = main.querySelector(`[data-submission="${kind}"]`)
  const focused = slot.contains(document.activeElement)
  slot.innerHTML = submission(stage, kind)
  if (focused) slot.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  if (kind !== 'learned') main.querySelector('[data-submission="learned"]').innerHTML = submission(stage, 'learned')
  if (context.course) {
    const { course } = context
    syncCourseProgress(course, stage, joinedCourseId)
    syncStageRules(course, stage)
    main.querySelector('[data-outline]').innerHTML = progress(course) + outline(course, stage.id)
  }
}

async function handleAction(control) {
  const action = control.dataset.action
  const id = control.dataset.id
  switch (action) {
    case 'login':
    case 'register': login(action); break
    case 'account': account(); break
    case 'retry-view': await navigate(); break
    case 'logout':
      await api('auth/logout', { method: 'POST' })
      accountChanged()
      await navigate('/', true)
      break
    case 'admin-course': {
      const admin = state.current.admin
      const hidden = control.dataset.hidden === 'true'
      const updated = await api('admin/courses/' + key(id), { method: 'PUT', body: { hidden } })
      views.invalidate()
      if (state.current?.admin !== admin) break
      admin.courses.find(course => course.id === id).moderated_at = updated.moderated_at
      const row = control.closest('tr')
      row.cells[1].textContent = hidden ? '已下架'
        : admin.courses.find(course => course.id === id).visibility === 'public' ? '公开' : '私有'
      control.dataset.hidden = String(!hidden)
      control.textContent = hidden ? '恢复' : '下架'
      announce(hidden ? '课程已下架。' : '课程已恢复。')
      break
    }
    case 'menu': {
      const opened = document.body.classList.toggle('menu-open')
      control.setAttribute('aria-expanded', String(opened))
      break
    }
    case 'close': dialog.close(); break
    case 'mcp': showMcp(); break
    case 'token':
    case 'revoke': {
      if (!requireLogin()) break
      const result = await api('token', { method: action === 'token' ? 'POST' : 'DELETE' })
      dialog.querySelector('[data-token-result]').innerHTML = result.token
        ? mcpConfigHtml(result.token)
        : '<p class="subtle" role="status">令牌已撤销，之前复制出去的配置将无法连接。</p>'
      break
    }
    case 'copy-config':
    case 'copy-command': {
      const field = dialog.querySelector(action === 'copy-config' ? '[data-mcp-config]' : '[data-mcp-command]')
      if (!field) break
      const copied = await copyText(field.value)
      if (!copied) {
        field.focus()
        field.select()
      }
      announce(copied ? '已复制，粘贴到 MCP 客户端即可。' : '复制失败，已为你选中文本，请手动复制。', !copied)
      break
    }
    case 'category':
      state.category = control.dataset.category
      main.querySelectorAll('[data-category]').forEach(element => {
        element.setAttribute('aria-pressed', String(element === control))
      })
      paintResults(state.current.courses)
      break
    case 'create-course':
      if (requireLogin()) await navigate('/course/new', true)
      break
    case 'join':
      if (requireLogin()) {
        const context = state.current
        const saved = await api('courses/' + key(context.course.id) + '/join', { method: 'POST' })
        views.invalidate((path, view) => view.type === 'explore' || view.type === 'shelf')
        views.update(view => {
          if (view.course?.id === saved.id) view.course = saved
        })
        const path = coursePath(saved.id)
        cachePage(path, { type: 'course', course: saved })
        if (context === state.current) await navigate(path)
        announce('已加入我的学习。')
      }
      break
    case 'learned': {
      if (!requireLogin()) break
      const context = state.current
      const { stage, course } = context
      const saved = await api('stages/' + key(stage.id) + '/learned', {
        method: 'PUT', body: { learned: !stage.learned, courseId: course?.id },
      })
      applyStage(saved, 'learned', context)
      announce(saved.learned ? '已标记学会。其他课程中的同一关卡已同步。' : '已撤销学会状态。')
      break
    }
    case 'new-stage':
      if (requireLogin()) showDialog('新建关卡', stageEditor(), true)
      break
    case 'edit-stage':
      if (requireLogin()) {
        const stage = id ? await api('stages/' + key(id)) : state.current.stage
        showDialog('编辑关卡', stageEditor(stage), true)
      }
      break
    case 'insert-submission': {
      const kind = control.dataset.kind
      if (!submissionKinds.includes(kind)) break
      const form = control.form
      const tutorial = form.elements.tutorial
      const status = form.querySelector('[data-placement-status]')
      const checkbox = form.querySelector(`input[name="methods"][value="${kind}"]`)
      const marker = `\n\n${submissionMarker(kind)}\n\n`
      if (hasSubmissionMarker(tutorial.value, kind)) {
        checkbox.checked = true
        status.textContent = '教程中已有这类提交框，可移动原标记调整位置。'
        break
      }
      if (tutorial.value.length + marker.length > tutorial.maxLength) {
        status.textContent = '教程已接近长度上限，请缩短内容后再插入。'
        break
      }
      const position = tutorial.selectionEnd
      tutorial.setRangeText(marker, position, position, 'end')
      checkbox.checked = true
      status.textContent = '已插入提交框。你可以移动教程中的标记调整位置。'
      tutorial.focus()
      break
    }
    case 'pick-stage': chooseStageDialog(); break
    case 'pick-deps': requiresDialog(id); break
    case 'attach-stage':
      state.editor.ids.push(id)
      dialog.close()
      paintPicked()
      break
    case 'remove-stage':
      state.editor.ids = state.editor.ids.filter(stageId => stageId !== id)
      pruneRequires()
      paintPicked()
      break
    case 'move-up':
    case 'move-down': {
      const ids = state.editor.ids
      const i = ids.indexOf(id)
      const j = i + (action === 'move-up' ? -1 : 1)
      if (i >= 0 && j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]]
      pruneRequires()
      paintPicked()
      main.querySelector(`[data-action="${action}"][data-id="${CSS.escape(id)}"]:not(:disabled)`)?.focus()
      break
    }
  }
}

async function handleForm(form) {
  const data = new FormData(form)
  const body = Object.fromEntries(data)
  switch (form.dataset.form) {
    case 'search':
      state.query = body.query
      state.category = ''
      if (state.path !== '/') await navigate('/', true)
      else paintExplore(state.current.courses)
      break
    case 'auth': {
      await api('auth/' + form.dataset.mode, { method: 'POST', body })
      accountChanged()
      await navigate()
      announce('已登录。')
      break
    }
    case 'admin-login': {
      const methods = Object.fromEntries(['chatgpt', 'password', 'oidc'].map(key => [key, data.has(key)]))
      await api('admin/login-methods', { method: 'PUT', body: methods })
      accountChanged()
      await refreshIdentity()
      if (!state.user?.isAdmin) await navigate('/', true)
      announce('登录方式已更新。')
      break
    }
    case 'admin-search': {
      const version = navigation
      const admin = await api('admin?q=' + key(data.get('q')))
      if (version !== navigation) break
      state.current = { admin }
      main.innerHTML = adminPage(admin)
      main.querySelector('input[name="q"]').focus({ preventScroll: true })
      break
    }
    case 'course': {
      const { course, ids, requires } = state.editor
      const saved = await api('courses' + (course ? '/' + key(course.id) : ''), {
        method: course ? 'PUT' : 'POST', body: { ...body, stageIds: ids, requires },
      })
      const path = coursePath(saved.id)
      views.invalidate()
      cachePage(path, { type: 'course', course: saved })
      await navigate(path, true)
      announce(course ? '课程已保存。' : '课程已创建。')
      break
    }
    case 'requires': {
      const stageId = form.dataset.stage
      state.editor.requires[stageId] = data.getAll('deps')
      pruneRequires()
      dialog.close()
      paintPicked()
      announce('已记录前置关卡，保存课程后生效。')
      break
    }
    case 'stage': {
      const id = form.dataset.id
      const saved = await api('stages' + (id ? '/' + key(id) : ''), {
        method: id ? 'PUT' : 'POST',
        body: { ...body, methods: data.getAll('methods'), required: data.getAll('required') },
      })
      views.invalidate()
      cachePage(stagePath(saved.id), { type: 'stage', course: null, stage: saved })
      dialog.close()
      if (!state.editor) {
        await navigate(id && state.current?.stage?.id === id ? state.path : stagePath(saved.id), true)
      } else {
        const { available, ids } = state.editor
        const index = available.findIndex(stage => stage.id === saved.id)
        if (index < 0) available.unshift(saved)
        else available[index] = saved
        if (!id) ids.push(saved.id)
        paintPicked()
      }
      announce(id ? '关卡已保存。' : '关卡已创建。')
      break
    }
    case 'answer':
    case 'upload': {
      if (!requireLogin()) break
      const context = state.current
      const { stage, course } = context
      const base = 'stages/' + key(stage.id)
      if (form.dataset.form === 'answer') {
        const saved = await api(base + '/answer', { method: 'PUT', body: { answer: body.answer, courseId: course?.id } })
        applyStage(saved, 'answer', context)
      } else {
        if (!body.upload.size || body.upload.size > 10 * 1024 * 1024) throw new Error('请选择一个不超过 10 MB 的非空文件。')
        const query = new URLSearchParams({ filename: body.upload.name })
        if (course) query.set('courseId', course.id)
        const saved = await api(base + '/upload/' + form.dataset.kind + '?' + query, { method: 'PUT', file: body.upload })
        applyStage(saved, form.dataset.kind, context)
      }
      announce('提交已保存。')
      break
    }
  }
}

let hoverTimer
document.addEventListener('pointerover', event => {
  const target = event.target.closest('a[data-link]')
  if (!target || target.contains(event.relatedTarget)) return
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => warmView(target.pathname), 85)
})
document.addEventListener('pointerout', event => {
  const target = event.target.closest('a[data-link]')
  if (target && !target.contains(event.relatedTarget)) clearTimeout(hoverTimer)
})
for (const type of ['focusin', 'pointerdown']) {
  document.addEventListener(type, event => {
    const target = event.target.closest('a[data-link]')
    if (target) warmView(target.pathname)
  })
}

document.addEventListener('click', async event => {
  const link = event.target.closest('a[data-link]')
  if (link && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    if (link.pathname === '/') {
      state.query = ''
      state.category = ''
    }
    await navigate(link.pathname, true, true)
    return
  }
  const control = event.target.closest('[data-action]')
  if (!control || control.disabled) return
  control.disabled = true
  try { await handleAction(control) } catch (error) { announce(error.message, true) } finally { control.disabled = false }
})

document.addEventListener('submit', async event => {
  const form = event.target
  if (!form.dataset.form) return
  event.preventDefault()
  const submitter = event.submitter
  const issue = form.querySelector('.form-error')
  if (issue) issue.hidden = true
  if (form.dataset.pending) return
  form.dataset.pending = 'true'
  if (submitter) submitter.disabled = true
  try {
    await handleForm(form)
  } catch (error) {
    if (issue) {
      issue.textContent = error.message
      issue.hidden = false
    } else announce(error.message, true)
  } finally {
    delete form.dataset.pending
    if (submitter) submitter.disabled = false
  }
})

document.addEventListener('input', event => {
  const input = event.target
  if (input.matches('[data-stage-filter]')) {
    for (const option of dialog.querySelectorAll('.stage-option')) {
      option.hidden = !option.textContent.toLowerCase().includes(input.value.trim().toLowerCase())
    }
  }
  if (input.matches('input[name="methods"]') && input.form?.dataset.form === 'stage') {
    const toggle = input.form.querySelector(`input[name="required"][value="${CSS.escape(input.value)}"]`)
    if (toggle) {
      toggle.disabled = !input.checked
      if (!input.checked) toggle.checked = false
    }
  }
  if (input.matches('input[type="file"]')) {
    input.closest('.upload-row').querySelector('.file-label').textContent = input.files[0]?.name ?? '最多 10 MB'
  }
  if (input.matches('.search-box input') && state.path === '/' && state.current?.courses) {
    state.query = input.value
    const feature = main.querySelector('.hero')
    if (feature) feature.hidden = Boolean(state.query)
    paintResults(state.current.courses)
  }
})

dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close()
})
window.addEventListener('popstate', () => navigate())
accountEvents?.addEventListener('message', () => {
  identityRevision++
  views.invalidate()
  navigate()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  const user = state.user?.id
  refreshIdentity().then(() => {
    if (user !== state.user?.id) navigate()
    else paintShell()
  }).catch(() => {})
})
try {
  paintShell()
  await navigate()
  const url = new URL(location.href)
  if (url.searchParams.get('auth_error') === 'oidc') {
    url.searchParams.delete('auth_error')
    history.replaceState({}, '', url)
    announce('OIDC 登录未完成，请重试。', true)
  }
} catch (error) {
  paintShell()
  main.innerHTML = note(error.message, 'close')
}
