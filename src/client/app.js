import { icon } from './icons.js'
import { adminPage, providerNames } from './admin.js'
import { createViewCache } from './view-cache.js'
import { createCourseAutosave } from './course-autosave.js'
import { lessonBlocks, lessonPayload, quickBlock, quickLesson, updateBlock } from './quick-lesson.js'
import { captureScreenshot, pasteScreenshot } from './screen-capture.js'
import { courseHistory, courseSharingForm, courseVersionPreview, editorChoices } from './collaboration.js'
import { wishBoard, wishCoursePicker, wishCourses, wishDiscussion, wishForm, wishHeading, wishPage, wishPath } from './wishes.js'
import { askMarker, hasSubmissionMarker, submissionKinds, submissionMarker, submissionSpecs } from './tutorial.js'
import {
  button, card, categories, courseEditor, coursePage, coursePath, esc, hero, key, link, note, notesPanel, outline,
  pickedStages, prerequisiteEditor, progress, stageEditor, stagePage, stagePath, stageStats, submission, visibility,
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
  if (state.user?.id !== profile.user?.id) state.editor?.autosave?.discard()
  if (state.user?.id !== profile.user?.id) state.quick?.autosave.discard()
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
      <blockquote>列出我创建过的关卡，用其中一个关卡创建一门叫「AI 视频练习」的私有课程。</blockquote>`)
    return
  }
  showDialog('MCP 连接', `<p>让外部助手（Claude Code、Cursor、Codex 等）通过 MCP 访问你在${productName}的课程、关卡和提交记录。</p>
    <label>MCP 地址<input readonly value="${esc(location.origin)}/mcp"></label>
    <div class="inline-actions">${button('token', '生成令牌并复制配置', 'btn primary', 'plug')}${button('revoke', '撤销令牌')}</div>
    <p class="subtle">每点一次都会生成新令牌，之前复制出去的配置随之失效。</p>
    <div data-token-result></div>`)
}

function activeNav() {
  if (state.path.startsWith('/wishes/')) return '/wishes'
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
    ['学习', [['/', '探索课程', 'compass'], ['/learning', '我的学习', 'book'], ['/wishes', '课程许愿', 'spark']]],
    ['创作', [['/owned', '我的创作', 'grid'], ['/stages', '我的关卡', 'layers']]],  ]
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
    <p>${own ? '管理你创建的课程，以及与你共享的协作课程。' : '继续已加入的课程，查看跨课程同步的关卡进度。'}</p></div>${action}</div>
    ${!state.user ? `<div class="sign-in-panel">${note('登录后查看你的课程。', 'lock')}${button('login', '登录')}</div>`
      : courses.length ? `<div class="catalog-grid">${courses.map(course => card(course, scope)).join('')}</div>`
        : note(own ? '这里会显示你创建的课程和协作邀请。' : '加入一门课程，或完成任意关卡提交，开始记录你的学习。')}`
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
      ${icon('arrow', 16)}</a>`).join('') || note('还没有关卡。到「我的创作」编辑课程，点「新建关卡」创建后就能在其他课程里引用。')}</div>`}

function paintView({ profile, view }, path) {
  state.editor?.autosave?.discard()
  state.quick?.autosave.discard()
  state.quick = null
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
    case 'wishes':
      state.current = { wishes: view.wishes, listRequest: 0 }
      main.innerHTML = wishBoard(view.wishes)
      break
    case 'wish':
      state.current = { wish: view.wish, userId: state.user?.id, moreReplies: false }
      main.innerHTML = wishPage(view.wish, state.user)
      break
    case 'editor':
      mountCourseEditor(view.course, view.available, view.prerequisiteChoices)
      break
    case 'course':
      state.current = { course: view.course }
      main.innerHTML = coursePage(view.course, state.user)
      break
    case 'stage':
      state.current = { course: view.course, stage: view.stage, userId: state.user?.id }
      if (view.course && !views.read(coursePath(view.course))) {
        cachePage(coursePath(view.course), { type: 'course', course: view.course })
      }
      main.innerHTML = stagePage(view.stage, view.course, view.course?.stages.find(item => item.id === view.stage.id), Boolean(state.user))
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
  if (!/^\/(?:learning|owned|stages|stage\/[^/]+|wishes(?:\/[^/]+)?|course\/(?!new$)[^/]+(?:\/stage\/[^/]+)?)?$/.test(path)) return
  views.load(path).catch(() => {})
}

function warmNext(view, version) {
  if (!view.course?.stages.length || view.course.learningLocked) return
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
    } else if ((['explore', 'shelf', 'library'].includes(data.view.type)
      || (data.view.type === 'wishes' && state.current?.wishes?.status === 'open' && state.current.wishes.page === 1)) && !dialog.open &&
      !main.contains(document.activeElement)) {
      paintView(data, path)
    } else {
      applyProfile(data.profile)
      paintShell()
    }
  }).catch(() => {})
}

async function navigate(path = location.pathname, push = false, focus = false) {
  closeZoom()
  const version = ++navigation
  if (state.quick?.autosave.dirty() && !await state.quick.autosave.flush()) {
    if (version === navigation && location.pathname !== state.path) history.pushState({}, '', state.path)
    return
  }
  if (state.editor?.autosave?.dirty() && !await state.editor.autosave.flush()) {
    if (version === navigation && location.pathname !== state.path) history.pushState({}, '', state.path)
    return
  }
  if (version !== navigation) return
  const cached = views.read(path)
  navigationProgress.hidden = true
  const showProgress = !cached && setTimeout(() => {
    if (version === navigation) navigationProgress.hidden = false
  }, 130)
  try {
    let data = cached?.data
    while (!data && version === navigation) data = await views.load(path)
    if (version !== navigation) return
    const course = data.view.course
    if (course && ['course', 'stage', 'editor'].includes(data.view.type)) {
      path = data.view.type === 'stage' ? stagePath(data.view.stage.id, course)
        : coursePath(course) + (data.view.type === 'editor' ? '/edit' : '')
    }
    if (push && path !== location.pathname) history.pushState({}, '', path)
    else if (path !== location.pathname) history.replaceState({}, '', path)
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


// 同一提问的写入依次完成，避免输入期间旧响应覆盖新答案。
const askSaves = new WeakMap()

function askValue(box) {
  if (box.dataset.kind === 'choice') {
    const select = box.querySelector('[data-ask-select]')
    const custom = box.querySelector('[data-ask-custom]')
    const others = select.value === '其他'
    custom.hidden = !others
    return others ? custom.value.trim() : select.value
  }
  return box.querySelector('[data-ask-text]').value
}

function scheduleAskSave(box) {
  const context = state.current
  if (!context?.stage) return
  const value = askValue(box)
  box.classList.toggle('filled', Boolean(value))
  let record = askSaves.get(box)
  if (!record) {
    record = { context, field: box.dataset.field, version: 0, savedVersion: 0, running: false }
    askSaves.set(box, record)
  }
  record.value = value
  record.version++
  clearTimeout(record.timer)
  record.timer = setTimeout(() => saveAskField(record), 700)
}

async function saveAskField(record) {
  if (record.running) return
  const { context } = record
  if (state.quick || context !== state.current || context.userId !== state.user?.id) return
  record.running = true
  try {
    while (record.savedVersion !== record.version && context === state.current
      && context.userId === state.user?.id && !state.quick) {
      const version = record.version
      const stageId = context.stage.id
      await api('stages/' + key(stageId) + '/field', {
        method: 'PUT', body: { field: record.field, value: record.value, courseId: context.course?.id },
      })
      record.savedVersion = version
      const request = context.fieldRefresh = (context.fieldRefresh ?? 0) + 1
      const updated = await api('stages/' + key(stageId) + (context.course ? '?courseId=' + key(context.course.id) : ''))
      if (request === context.fieldRefresh) applyStage(updated, 'field', context)
    }
  } catch (error) {
    if (context === state.current) announce(error.message, true)
  } finally {
    record.running = false
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
    stage.locked = !Boolean(course.canEdit) && !stage.learned
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

function courseDraft(editor, form) {
  const data = Object.fromEntries(new FormData(form))
  const { title, description, category, theme, visibility } = data
  const progress = typeof data['progress-label'] === 'string' ? data['progress-label'] : ''
  const labels = [
    ...(progress ? [progress] : []),
    ...(data['co-create'] ? ['co-create'] : []),
    ...(data.featured ? ['featured'] : []),
  ]
  return {
    title, description, category, theme, visibility: visibility ?? editor.course?.visibility, labels,
    stageIds: [...editor.ids],
    requires: Object.fromEntries([...editor.ids].map(id => [id, editor.requires?.[id] ?? []])),
    ...(!editor.course || editor.course.owned
      ? { alias: (data.alias ?? '').trim().toLowerCase(),
        prerequisites: editor.prerequisites.map(({ courseId, mode }) => ({ courseId, mode })) } : {}),
  }
}

function lessonDraft(form) {
  const { title, task, tutorial, alias } = Object.fromEntries(new FormData(form))
  return { title, task, tutorial, alias: (alias ?? '').trim().toLowerCase() }
}

function courseWriteBody(editor, payload) {
  return { ...payload, expectedRevision: editor.course.revision, expectedEditorId: editor.userId }
}

function syncCourseEditor(editor, course, stage) {
  if (editor.userId !== state.user?.id) return
  editor.course = course
  const updated = new Map(course.stages.map(item => [item.id, item]))
  if (stage && !editor.available.some(item => item.id === stage.id)) editor.available.unshift(stage)
  editor.available = editor.available.map(item => ({ ...item, ...updated.get(item.id) }))
  editor.requires = Object.fromEntries(course.stages.map(item => [item.id, item.requires ?? []]))
  views.invalidate((path, view) => view.course?.id === course.id || ['explore', 'shelf'].includes(view.type))
  cachePage(coursePath(course), { type: 'course', course })
  if (editor === state.editor) {
    paintPicked()
    const path = coursePath(course) + '/edit'
    if (path !== state.path) {
      history.replaceState({}, '', path)
      state.path = path
    }
    main.querySelector('.breadcrumb a').href = coursePath(course)
  }
}

function mountCourseEditor(course, available, prerequisiteChoices = []) {
  const editor = {
    course, available, ids: course?.stages.map(stage => stage.id) ?? [], userId: state.user?.id,
    isAdmin: Boolean(state.user?.isAdmin),
    requires: Object.fromEntries((course?.stages ?? []).map(stage => [stage.id, stage.requires ?? []])),
    newStages: new Map(), prerequisites: course?.prerequisites ?? [], prerequisiteChoices,
  }
  state.editor = editor
  main.innerHTML = courseEditor(editor)
  if (!course) return
  editor.autosave = createCourseAutosave({
    status(message, kind) {
      if (editor !== state.editor) return
      for (const element of document.querySelectorAll('[data-course-save-status], [data-lesson-save-status]')) {
        element.textContent = message
        element.toggleAttribute('data-error', Boolean(kind))
      }
      main.querySelector('[data-course-reload]').hidden = !kind
      const reload = dialog.querySelector('[data-lesson-reload]')
      if (reload) reload.hidden = !kind
    },
    async send(target, payload) {
      const base = 'courses/' + key(course.id)
      const lesson = target !== 'course'
      const saved = await api(lesson ? base + '/stages/' + key(target) : base, {
        method: 'PUT', body: courseWriteBody(editor, payload),
      })
      syncCourseEditor(editor, lesson ? saved.course : saved, lesson ? saved.stage : undefined)
    },
  })
  editor.autosave.remember('course', courseDraft(editor, main.querySelector('[data-form="course"]')))
}

function queueCourseDraft(form = main.querySelector('[data-form="course"]')) {
  const editor = state.editor
  if (!editor?.autosave || !form) return
  if (form.dataset.form === 'course') editor.autosave.queue('course', courseDraft(editor, form))
  if (form.dataset.form === 'course-lesson') editor.autosave.queue(form.dataset.id, lessonDraft(form))
}

function fitQuickTitle() {
  const title = main.querySelector('[data-quick-title]')
  if (!title) return
  title.style.height = 'auto'
  title.style.height = title.scrollHeight + 2 + 'px'
}

window.addEventListener('resize', fitQuickTitle)

async function startQuickLesson() {
  const context = state.current
  if (!context?.course?.canEdit || state.quick) return
  const data = await api('view?path=' + key(state.path))
  if (state.current !== context || data.profile.user?.id !== state.user?.id || !data.view.course?.canEdit) return
  Object.assign(context, { course: data.view.course, stage: data.view.stage })
  if (!context.stage) return
  const editor = {
    context, userId: state.user.id, course: context.course, stageId: context.stage.id,
    title: context.stage.title, task: context.stage.task, blocks: lessonBlocks(context.stage.tutorial),
    alias: context.stage.alias ?? '',
    enabled: [...context.stage.methods], required: [...context.stage.required],
    requiredFields: [...context.stage.requiredFields],
  }
  state.quick = editor
  main.querySelector('.lesson').classList.add('quick-lesson')
  main.querySelector('.lesson').innerHTML = quickLesson(editor)
  fitQuickTitle()
  editor.autosave = createCourseAutosave({
    status(message, kind) {
      if (state.quick !== editor) return
      const status = main.querySelector('[data-quick-save]')
      status.textContent = message
      status.toggleAttribute('data-error', Boolean(kind))
      main.querySelector('[data-quick-reload]').hidden = !kind
    },
    async send(target, payload) {
      const saved = await api('courses/' + key(editor.course.id) + '/stages/' + key(editor.stageId), {
        method: 'PUT', body: { ...payload, expectedRevision: editor.course.revision, expectedEditorId: editor.userId },
      })
      editor.course = saved.course
      if (state.quick !== editor || state.user?.id !== editor.userId) return
      context.course = saved.course
      context.stage = { ...context.stage, ...saved.stage }
      const path = stagePath(editor.stageId, saved.course)
      if (path !== state.path) {
        history.replaceState({}, '', path)
        state.path = path
      }
      views.invalidate((path, view) => view.course?.id === saved.course.id || ['explore', 'shelf'].includes(view.type))
      cachePage(coursePath(saved.course), { type: 'course', course: saved.course })
      main.querySelector('[data-outline]').innerHTML = progress(saved.course) + outline(saved.course, editor.stageId)
    },
  })
  editor.autosave.remember('lesson', lessonPayload(editor))
}

function queueQuickLesson() {
  const editor = state.quick
  if (editor) editor.autosave.queue('lesson', lessonPayload(editor))
}

function paintQuickBlocks() {
  const editor = state.quick
  main.querySelector('[data-quick-blocks]').innerHTML = editor.blocks.map((block, index) => quickBlock(block, editor, index)).join('')
}

async function searchCollaborators() {
  const editor = state.editor
  const sharing = editor.sharing
  const query = dialog.querySelector('[data-collaborator-search]').value.trim()
  const version = sharing.searchVersion = (sharing.searchVersion ?? 0) + 1
  const result = query ? await api('courses/' + key(editor.course.id) + '/sharing/users?q=' + key(query)) : []
  if (editor !== state.editor || sharing !== editor.sharing || sharing.searchVersion !== version) return
  const choices = dialog.querySelector('[data-collaborator-choices]')
  if (!choices) return
  sharing.results = result
  sharing.searched = Boolean(query)
  choices.innerHTML = editorChoices(sharing)}

function chooseStageDialog() {
  const entries = state.editor.available.filter(stage => stage.owned && !state.editor.ids.includes(stage.id))
  showDialog('引用已有的关卡', `<label>搜索关卡<input type="search" placeholder="输入名称或作者" data-stage-filter></label>
    <p class="subtle">只能引用你自己创建的关卡；同一个关卡在多门课程里共用学会状态和提交记录。</p>    <div class="stage-options">${entries.map(stage => `<button type="button" class="stage-option" data-action="attach-stage" data-id="${esc(stage.id)}">
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


function applyNotes(result, context) {
  if (context !== state.current) return
  context.stage.notes = result.notes
  context.stage.noteCanWrite = result.canWrite
  const current = main.querySelector('[data-notes]')
  if (!current) return
  const holder = document.createElement('div')
  holder.innerHTML = notesPanel(result.notes, result.canWrite)
  current.replaceWith(holder.firstElementChild)
}

function applyStage(stage, kind, context) {
  if (context.userId !== state.user?.id) return
  const joinedCourseId = kind !== 'learned' || stage.learned ? context.course?.id : null
  const changesEnrollment = joinedCourseId && !context.course.joined
  views.invalidate((path, view) => (view.type === 'shelf' && (view.scope === 'joined' || changesEnrollment))
    || (changesEnrollment && view.type === 'explore') || (kind === 'learned' && view.course?.prerequisites?.length > 0)
    || (view.course?.id !== context.course?.id
      && (view.stage?.id === stage.id || view.course?.stages.some(item => item.id === stage.id))))
  views.update(view => {
    if (view.stage?.id === stage.id) view.stage = { ...view.stage,
      learned: stage.learned, submissions: stage.submissions, stats: stage.stats,
      missing: stage.missing, missingFields: stage.missingFields, answers: stage.answers, fieldStats: stage.fieldStats }
    syncCourseProgress(view.course, stage, joinedCourseId)
    syncStageRules(view.course, stage)
  })
  if (context !== state.current) return
  context.stage = stage
  if (state.quick) return
  main.querySelector('[data-stage-stats]').innerHTML = stageStats(stage)
  for (const box of main.querySelectorAll('[data-ask-field]')) {
    const count = stage.fieldStats?.find(item => item.field === box.dataset.field)?.count ?? 0
    box.querySelector('[data-field-count]').textContent = '已有 ' + count + ' 人填写'
  }
  for (const slot of main.querySelectorAll(`[data-submission="${kind}"]`)) {
    const focused = slot.contains(document.activeElement)
    const prompt = slot.querySelector('.submit-prompt')?.textContent ?? ''
    slot.innerHTML = submission(stage, kind, prompt)
    if (focused) slot.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  }
  if (kind !== 'learned') renderLearned(stage)
  if (context.course) {
    const { course } = context
    syncCourseProgress(course, stage, joinedCourseId)
    syncStageRules(course, stage)
    main.querySelector('[data-outline]').innerHTML = progress(course) + outline(course, stage.id)
  }
}

function renderLearned(stage) {
  for (const slot of main.querySelectorAll('[data-submission="learned"]')) {
    const focused = slot.contains(document.activeElement)
    slot.innerHTML = submission(stage, 'learned')
    if (focused) slot.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  }
}

async function uploadStageFile(context, kind, file) {
  if (context !== state.current || context.userId !== state.user?.id) throw new Error('页面或登录账号已切换，请重新提交。')
  if (!file?.size || file.size > 10 * 1024 * 1024) throw new Error('请选择一个不超过 10 MB 的非空文件。')
  const query = new URLSearchParams({ filename: file.name })
  if (context.course) query.set('courseId', context.course.id)
  const saved = await api('stages/' + key(context.stage.id) + '/upload/' + kind + '?' + query, { method: 'PUT', file })
  applyStage(saved, kind, context)
}

function screenshotOptions(context) {
  return {
    dialog, showDialog,
    isCurrent: () => context === state.current && context.userId === state.user?.id,
    async upload(file) {
      await uploadStageFile(context, 'screenshot', file)
      announce('截图已上传。')
    },
  }
}

async function filterWishes(status, page) {
  const context = state.current
  const request = ++context.listRequest
  const data = await api('wishes?' + new URLSearchParams({ status, page }))
  if (context !== state.current || request !== context.listRequest) return
  context.wishes = data
  main.innerHTML = wishBoard(data)
  if (page > 1) main.querySelector('.wish-board').scrollIntoView({ block: 'start' })
}

function applyWish(updated, context) {
  if (context.userId !== state.user?.id) return false
  const path = wishPath(updated.id)
  const active = state.current?.wish?.id === updated.id ? state.current : null
  const cached = views.read(path)?.data.view.wish
  if (updated.revision < Math.max(active?.wish.revision ?? 0, cached?.revision ?? 0)) return false
  views.invalidate((path, view) => view.type === 'wishes' || view.wish?.id === updated.id)
  cachePage(path, { type: 'wish', wish: updated })
  if (!active) return false
  if (active.moreReplies) {
    const entries = new Map([...active.wish.replies.items, ...updated.replies.items].map(reply => [reply.id, reply]))
    updated = { ...updated, replies: {
      items: [...entries.values()].sort((left, right) => left.id - right.id),
      before: active.wish.replies.before,
    } }
  }
  active.wish = updated
  main.querySelector('[data-wish-heading]').innerHTML = wishHeading(updated)
  main.querySelector('[data-wish-discussion]').innerHTML = wishDiscussion(updated)
  main.querySelector('[data-wish-courses]').innerHTML = wishCourses(updated)
  return true
}

async function updateWish(path, method, body, context) {
  const updated = await api('wishes/' + key(context.wish.id) + '/' + path, { method, body })
  return applyWish(updated, context)
}

async function handleAction(control) {
  const action = control.dataset.action
  const id = control.dataset.id
  switch (action) {
    case 'quick-lesson':
      await startQuickLesson()
      break
    case 'quick-insert-menu': {
      const menu = control.closest('.quick-insert').querySelector('.quick-insert-menu')
      menu.hidden = !menu.hidden
      break
    }
    case 'quick-text': {
      const block = control.closest('[data-quick-block]')
      block.querySelector('.quick-text-preview').hidden = true
      const area = block.querySelector('.quick-text-input')
      area.hidden = false
      const input = area.querySelector('textarea')
      input.style.height = input.scrollHeight + 'px'
      input.focus()
      break
    }
    case 'quick-done':
    case 'quick-reload': {
      const editor = state.quick
      if (action === 'quick-done' && !await editor.autosave.flush()) break
      if (state.quick !== editor) break
      editor.autosave.discard()
      state.quick = null
      views.invalidate((path) => path === state.path)
      await navigate()
      break
    }
    case 'quick-checkpoint': {
      const editor = state.quick
      if (!await editor.autosave.flush() || state.quick !== editor) break
      const saved = await api('courses/' + key(editor.course.id) + '/stages/' + key(editor.stageId), {
        method: 'PUT', body: { ...lessonPayload(editor), checkpoint: true,
          expectedRevision: editor.course.revision, expectedEditorId: editor.userId },
      })
      if (state.quick === editor) {
        editor.course = saved.course
        announce('当前版本已保存。')
      }
      break
    }
    case 'quick-add': {
      const editor = state.quick
      const type = control.dataset.type ?? main.querySelector('[data-quick-type]').value
      if (type !== 'text' && type !== 'question' && editor.blocks.some(block => block.type === type)) {
        announce('这类提交框已经存在，可以在原位置编辑。')
        break
      }
      const question = type === 'question'
      const block = {
        id: crypto.randomUUID(), type, name: '新问题', fieldKey: 'q-' + crypto.randomUUID(),
        options: [], prompt: '请在这里填写具体的提交要求',
      }
      block.raw = type === 'text' ? '新段落\n\n' : question
        ? '{{ask:新问题||key=' + block.fieldKey + '}}\n\n' : submissionMarker(type, block.prompt) + '\n\n'
      if (editor.blocks.length && !editor.blocks.at(-1).raw.endsWith('\n\n')) editor.blocks.at(-1).raw += '\n\n'
      const after = editor.blocks.findIndex(item => item.id === control.dataset.after)
      editor.blocks.splice(after < 0 ? editor.blocks.length : after + 1, 0, block)
      if (!question && type !== 'text') editor.enabled.push(type)
      paintQuickBlocks()
      queueQuickLesson()
      main.querySelector(`[data-quick-block="${block.id}"]`).scrollIntoView({ block: 'center', behavior: 'smooth' })
      break
    }
    case 'quick-up':
    case 'quick-down':
    case 'quick-remove': {
      const editor = state.quick
      const index = editor.blocks.findIndex(block => block.id === id)
      if (index < 0) break
      if (action === 'quick-remove') {
        const [block] = editor.blocks.splice(index, 1)
        if (block.type === 'question') editor.requiredFields = editor.requiredFields.filter(key => key !== block.fieldKey)
        else if (block.type !== 'text' && !editor.blocks.some(item => item.type === block.type)) {
          editor.enabled = editor.enabled.filter(kind => kind !== block.type)
          editor.required = editor.required.filter(kind => kind !== block.type)
        }
      } else {
        const next = index + (action === 'quick-up' ? -1 : 1)
        if (next < 0 || next >= editor.blocks.length) break
        for (const block of editor.blocks) if (!block.raw.endsWith('\n\n')) block.raw += '\n\n'
        const [block] = editor.blocks.splice(index, 1)
        editor.blocks.splice(next, 0, block)
      }
      paintQuickBlocks()
      queueQuickLesson()
      break
    }
    case 'login':
    case 'register': login(action); break
    case 'account': account(); break
    case 'retry-view': await navigate(); break
    case 'reload-course':
      state.editor.autosave.discard()
      views.invalidate((path) => path === state.path)
      await navigate()
      break
    case 'course-sharing': {
      const editor = state.editor
      if (!await editor.autosave.flush() || editor !== state.editor) break
      const sharing = await api('courses/' + key(editor.course.id) + '/sharing')
      if (editor !== state.editor) break
      editor.sharing = sharing
      showDialog('课程共享设置', courseSharingForm(sharing), true)
      break
    }
    case 'find-collaborators':
      await searchCollaborators()
      break
    case 'add-collaborator':
    case 'remove-collaborator': {
      const sharing = state.editor.sharing
      if (action === 'add-collaborator') {
        const user = sharing.results.find(user => user.id === id)
        if (user && !sharing.editors.some(editor => editor.id === id)) sharing.editors.push(user)
      } else sharing.editors = sharing.editors.filter(editor => editor.id !== id)
      dialog.querySelector('[data-collaborator-choices]').innerHTML = editorChoices(sharing)
      break
    }
    case 'course-history':
    case 'more-course-versions': {
      const editor = state.editor
      const cursor = control.dataset.before ? '?before=' + key(control.dataset.before) : ''
      const page = await api('courses/' + key(editor.course.id) + '/versions' + cursor)
      if (editor !== state.editor) break
      const items = cursor && editor.history ? [...editor.history.items, ...page.items] : page.items
      editor.history = { ...page, items }
      showDialog('课程历史版本', courseHistory(editor.history), true)
      break
    }
    case 'preview-course-version': {
      const editor = state.editor
      const version = await api('courses/' + key(editor.course.id) + '/versions/' + key(id))
      if (editor === state.editor) showDialog('查看版本 ' + version.revision, courseVersionPreview(version), true)
      break
    }
    case 'restore-course-version': {
      const editor = state.editor
      if (!await editor.autosave.flush() || editor !== state.editor) break
      const course = await api('courses/' + key(editor.course.id) + '/versions/' + key(id), {
        method: 'POST', body: courseWriteBody(editor, {}),
      })
      syncCourseEditor(editor, course)
      if (editor === state.editor) await navigate()
      announce('历史版本已恢复。')
      break
    }
    case 'wish-new':
      if (requireLogin()) showDialog('发布课程许愿', wishForm(), true)
      break
    case 'wish-filter':
      await filterWishes(control.dataset.status, 1)
      break
    case 'wish-page':
      await filterWishes(state.current.wishes.status, Number(control.dataset.page))
      break
    case 'wish-older': {
      const context = state.current
      const before = context.wish.replies.before
      const older = await api('wishes/' + key(context.wish.id) + '/replies?before=' + before)
      if (context !== state.current || context.wish.replies.before !== before) break
      context.moreReplies = true
      context.wish.replies = { items: [...older.items, ...context.wish.replies.items], before: older.before }
      main.querySelector('[data-wish-discussion]').innerHTML = wishDiscussion(context.wish)
      break
    }
    case 'wish-picker': {
      if (!requireLogin()) break
      const context = state.current
      const cached = views.read('/')
      const courses = cached?.fresh ? cached.data.view.courses : await api('courses')
      if (context !== state.current) break
      const linked = new Set(context.wish.courses.map(course => course.id))
      showDialog('关联公开课程', wishCoursePicker(courses.filter(course => !linked.has(course.id))), true)
      dialog.querySelector('input')?.focus()
      break
    }
    case 'wish-attach': {
      const context = state.current
      const updated = await updateWish('courses', 'POST', { courseId: id }, context)
      if (updated && dialog.contains(control)) dialog.close()
      announce('课程已关联。')
      break
    }
    case 'wish-vote':
      await updateWish('courses/' + key(id), 'PUT', { reaction: control.dataset.reaction }, state.current)
      announce('课程反馈已保存。')
      break
    case 'wish-status': {
      const status = control.dataset.status
      await updateWish('status', 'PUT', { status }, state.current)
      announce(status === 'closed' ? '许愿已完结。' : '许愿已重新打开。')
      break
    }
    case 'logout':
      await api('auth/logout', { method: 'POST' })
      accountChanged()
      await navigate('/', true)
      break
    case 'admin-featured': {
      const admin = state.current.admin
      const featured = control.dataset.featured === 'true'
      const updated = await api('admin/courses/' + key(id), { method: 'PUT', body: { featured } })
      views.invalidate()
      if (state.current?.admin !== admin) break
      admin.courses.find(course => course.id === id).labels = updated.labels
      main.innerHTML = adminPage(admin)
      announce(featured ? '已设为精品。' : '已取消精品。')
      break
    }
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
    case 'add-prerequisite':
    case 'remove-prerequisite': {
      const editor = state.editor
      if (action === 'add-prerequisite') {
        const selection = main.querySelector('[data-prerequisite-choice]').value
        const course = editor.prerequisiteChoices.find(item => item.id === selection)
        if (!course || editor.prerequisites.length >= 12) break
        editor.prerequisites.push({ courseId: course.id, title: course.title, visibility: course.visibility, mode: 'recommended' })
      } else editor.prerequisites = editor.prerequisites.filter(item => item.courseId !== id)
      main.querySelector('[data-prerequisite-editor]').innerHTML = prerequisiteEditor(editor)
      queueCourseDraft()
      break
    }
    case 'join':
      if (requireLogin()) {
        const context = state.current
        const saved = await api('courses/' + key(context.course.id) + '/join', { method: 'POST' })
        views.invalidate((path, view) => view.type === 'explore' || view.type === 'shelf')
        views.update(view => {
          if (view.course?.id === saved.id) view.course = saved
        })
        const path = coursePath(saved)
        cachePage(path, { type: 'course', course: saved })
        if (context === state.current) await navigate(path)
        announce('已加入我的学习。')
      }
      break
    case 'learned': {
      if (!requireLogin()) break
      const context = state.current
      if (context.pendingLearned) break
      const { stage, course } = context
      context.pendingLearned = true
      main.querySelectorAll('[data-action="learned"]').forEach(button => { button.disabled = true })
      try {
        const saved = await api('stages/' + key(stage.id) + '/learned', {
          method: 'PUT', body: { learned: !stage.learned, courseId: course?.id },
        })
        applyStage(saved, 'learned', context)
        announce(saved.learned ? '已标记学会。其他课程中的同一关卡已同步。' : '已撤销学会状态。')
      } finally {
        context.pendingLearned = false
        if (context === state.current) renderLearned(context.stage)
      }
      break
    }
    case 'capture-screen': {
      if (!requireLogin()) break
      const context = state.current
      await captureScreenshot(screenshotOptions(context))
      break
    }
    case 'new-stage': {
      if (!requireLogin()) break
      const editor = state.editor
      if (editor?.course) {
        if (await editor.autosave.flush() && editor === state.editor) {
          showDialog('为课程新建关卡', stageEditor(null, 'course-new-stage'), true)
        }
      } else if (editor) {
        const visibility = main.querySelector('[data-form="course"]').elements.visibility.value
        showDialog('为课程新建关卡', stageEditor({ visibility }, 'course-draft-stage'), true)
      }
      break
    }
    case 'edit-course-lesson': {
      const editor = state.editor
      const saved = await editor.autosave.flush()
      if (editor !== state.editor) break
      const draft = editor.autosave.draft(id)
      if (!saved && (!draft || editor.lastLesson?.id !== id)) break
      const stage = saved ? await api('courses/' + key(editor.course.id) + '/stages/' + key(id))
        : { ...editor.lastLesson, ...draft }
      if (editor !== state.editor) break
      editor.lastLesson = stage
      showDialog('编辑课程讲义', stageEditor(stage, 'course-lesson'), true)
      editor.autosave.remember(id, lessonDraft(dialog.querySelector('[data-form="course-lesson"]')))
      if (!saved) {
        const status = dialog.querySelector('[data-lesson-save-status]')
        status.textContent = main.querySelector('[data-course-save-status]').textContent
        status.setAttribute('data-error', '')
        dialog.querySelector('[data-lesson-reload]').hidden = false
      }
      break
    }
    case 'edit-stage':
      if (requireLogin()) {
        const draft = state.editor?.newStages.get(id)
        const stage = draft ?? await api('stages/' + key(id) + '?manage=1')
        showDialog('编辑关卡', stageEditor(stage, draft ? 'course-draft-stage' : 'stage'), true)
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
        if (checkbox) checkbox.checked = true
        const spec = submissionSpecs(tutorial.value).find(item => item.kind === kind)
        status.textContent = spec?.prompt
          ? '教程中已有这类提交框，可移动原标记调整位置。'
          : `已有标记但没写说明：把它改成 {{submit:${kind}|这一题要交什么}}。`
        break
      }
      const promptInput = form.querySelector('[data-submit-prompt]')
      const promptText = (promptInput?.value ?? '').trim().replace(/[|\n}]/g, ' ').slice(0, 300)
      if (promptText.length < 4) {
        status.textContent = '先在上面写清这一题要交什么（例如：写下 3 个候选和理由），再插入提交框。'
        promptInput?.focus()
        break
      }
      const withPrompt = `\n\n${submissionMarker(kind, promptText)}\n\n`
      if (tutorial.value.length + withPrompt.length > tutorial.maxLength) {
        status.textContent = '教程已接近长度上限，请缩短内容后再插入。'
        break
      }
      const position = tutorial.selectionEnd
      tutorial.setRangeText(withPrompt, position, position, 'end')
      if (checkbox) checkbox.checked = true
      status.textContent = '已插入提交框。你可以移动教程中的标记调整位置。'
      tutorial.focus()
      queueCourseDraft(form)
      break
    }
    case 'note-delete':
    case 'note-visibility': {
      if (!requireLogin()) break
      const context = state.current
      const id = control.dataset.id
      if (action === 'note-delete' && !confirm('删除这条笔记？')) break
      const result = action === 'note-delete'
        ? await api('stages/' + key(context.stage.id) + '/notes/' + key(id), { method: 'DELETE' })
        : await api('stages/' + key(context.stage.id) + '/notes/' + key(id), {
          method: 'PUT', body: { visibility: control.dataset.next },
        })
      applyNotes(result, context)
      announce(action === 'note-delete' ? '笔记已删除。' : '可见性已更新。')
      break
    }
    case 'insert-ask': {
      const form = control.form
      const tutorial = form?.elements?.tutorial
      if (!tutorial) break
      const name = form.querySelector('[data-ask-question]').value.trim()
      if (!name) { announce('先写清要问什么。', true); break }
      const options = form.querySelector('[data-ask-options]').value.split(/[,，]/)
        .map(value => value.trim()).filter(Boolean).slice(0, 12)
      const marker = `\n\n${askMarker(name, options)}\n\n`
      if (tutorial.value.length + marker.length > tutorial.maxLength) {
        announce('教程已接近长度上限，请缩短内容后再插入。', true)
        break
      }
      const promptInput = form.querySelector('[data-submit-prompt]')
      const promptText = (promptInput?.value ?? '').trim().replace(/[|\n}]/g, ' ').slice(0, 300)
      if (promptText.length < 4) {
        status.textContent = '先在上面写清这一题要交什么（例如：写下 3 个候选和理由），再插入提交框。'
        promptInput?.focus()
        break
      }
      const withPrompt = `\n\n${submissionMarker(kind, promptText)}\n\n`
      if (tutorial.value.length + withPrompt.length > tutorial.maxLength) {
        status.textContent = '教程已接近长度上限，请缩短内容后再插入。'
        break
      }
      const position = tutorial.selectionEnd
      tutorial.setRangeText(withPrompt, position, position, 'end')
      tutorial.focus()
      queueCourseDraft(form)
      announce('已插入提问，学习者可以在对应步骤直接填写。')
      break
    }
    case 'pick-stage': chooseStageDialog(); break
    case 'pick-deps': requiresDialog(id); break
    case 'attach-stage':
      state.editor.ids.push(id)
      dialog.close()
      paintPicked()
      queueCourseDraft()
      break
    case 'remove-stage':
      state.editor.ids = state.editor.ids.filter(stageId => stageId !== id)
      pruneRequires()
      if (state.editor.newStages.delete(id)) state.editor.available = state.editor.available.filter(stage => stage.id !== id)
      paintPicked()
      queueCourseDraft()
      break
    case 'move-up':
    case 'move-down': {
      const ids = state.editor.ids
      const i = ids.indexOf(id)
      const j = i + (action === 'move-up' ? -1 : 1)
      if (i >= 0 && j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]]
      pruneRequires()
      paintPicked()
      queueCourseDraft()
      main.querySelector(`[data-action="${action}"][data-id="${CSS.escape(id)}"]:not(:disabled)`)?.focus()
      break
    }
  }
}

async function handleForm(form) {
  const data = new FormData(form)
  const body = Object.fromEntries(data)
  switch (form.dataset.form) {
    case 'wish-create': {
      const author = state.user?.id
      const wish = await api('wishes', { method: 'POST', body })
      if (author !== state.user?.id) break
      views.invalidate((path, view) => view.type === 'wishes')
      const path = wishPath(wish.id)
      cachePage(path, { type: 'wish', wish })
      await navigate(path, true)
      announce('许愿已发布。')
      break
    }
    case 'wish-reply': {
      const updated = await updateWish('replies', 'POST', body, state.current)
      if (updated && form.elements.body.value === body.body) form.reset()
      announce('回复已发布。')
      break
    }
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
      const editor = state.editor
      if (editor.course) {
        queueCourseDraft(form)
        if (!await editor.autosave.flush() || editor !== state.editor) break
        const saved = await api('courses/' + key(editor.course.id), {
          method: 'PUT', body: courseWriteBody(editor, { ...courseDraft(editor, form), checkpoint: true }),
        })
        syncCourseEditor(editor, saved)
        announce('已保存一个历史版本。')
        break
      }
      const newStages = [...editor.newStages.values()].map(({ id, ...stage }) => ({ ...stage, clientId: id }))
      const saved = await api('courses', { method: 'POST', body: { ...courseDraft(editor, form), newStages } })
      const path = coursePath(saved)
      views.invalidate()
      cachePage(path, { type: 'course', course: saved })
      await navigate(path, true)
      announce('课程已创建。')
      break
    }
    case 'course-lesson':
      queueCourseDraft(form)
      if (await state.editor.autosave.flush() && dialog.contains(form)) dialog.close()
      break
    case 'course-draft-stage': {
      const editor = state.editor
      const id = form.dataset.id || crypto.randomUUID()
      const stage = { ...body, id, owned: true, methods: ['learned', ...data.getAll('methods')] }
      if (editor.newStages.has(id)) editor.available = editor.available.map(item => item.id === id ? stage : item)
      else {
        editor.available.unshift(stage)
        editor.ids.push(id)
      }
      editor.newStages.set(id, stage)
      paintPicked()
      dialog.close()
      break
    }
    case 'course-new-stage': {
      const editor = state.editor
      const { course, stage } = await api('courses/' + key(editor.course.id) + '/stages', {
        method: 'POST',
        body: courseWriteBody(editor, { ...body, methods: data.getAll('methods'), required: data.getAll('required') }),
      })
      editor.ids.push(stage.id)
      syncCourseEditor(editor, course, stage)
      if (editor === state.editor) {
        editor.autosave.remember('course', courseDraft(editor, main.querySelector('[data-form="course"]')))
        dialog.close()
      }
      announce('课程关卡已创建。')
      break
    }
    case 'course-sharing': {
      const editor = state.editor
      const saved = await api('courses/' + key(editor.course.id) + '/sharing', {
        method: 'PUT', body: { mode: body.mode, editorIds: editor.sharing.editors.map(user => user.id),
          expectedRevision: editor.sharing.revision, expectedEditorId: editor.userId },
      })
      syncCourseEditor(editor, saved)
      if (editor === state.editor) await navigate()
      announce('课程共享已更新。')
      break
    }
    case 'note':
    case 'reply': {
      if (!requireLogin()) break
      const context = state.current
      const base = 'stages/' + key(context.stage.id) + '/notes'
      const result = form.dataset.form === 'note'
        ? await api(base, { method: 'POST', body: { body: body.body, visibility: body.visibility } })
        : await api(base, { method: 'POST', body: { body: body.body, parentId: form.dataset.parent } })
      applyNotes(result, context)
      form.elements.body.value = ''
      announce(form.dataset.form === 'note' ? '笔记已发布。' : '回复已发布。')
      break
    }
    case 'requires': {
      const stageId = form.dataset.stage
      state.editor.requires[stageId] = data.getAll('deps')
      pruneRequires()
      dialog.close()
      paintPicked()
      queueCourseDraft()
      announce('已更新前置关卡。')
      break
    }
    case 'stage': {
      const id = form.dataset.id
      const saved = await api('stages/' + key(id), {
        method: 'PUT', body: { ...body, methods: data.getAll('methods'), required: data.getAll('required') },      })
      views.invalidate()
      dialog.close()
      if (!state.editor) {
        await navigate()
      } else {
        const { available } = state.editor
        const index = available.findIndex(stage => stage.id === saved.id)
        if (index < 0) available.unshift(saved)
        else available[index] = saved
        paintPicked()
      }
      announce('关卡已保存。')
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
        await uploadStageFile(context, form.dataset.kind, body.upload)
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

// 教程里的截图：默认限宽显示，点一下看原图。
let zoomLayer
let zoomReturnFocus
function closeZoom() {
  if (!zoomLayer) return
  zoomLayer.remove()
  zoomLayer = null
  document.body.style.overflow = ''
  if (zoomReturnFocus?.isConnected) zoomReturnFocus.focus({ preventScroll: true })
  zoomReturnFocus = null
}
function openZoom(image) {
  closeZoom()
  zoomReturnFocus = document.activeElement
  zoomLayer = document.createElement('div')
  zoomLayer.className = 'img-zoom'
  zoomLayer.setAttribute('role', 'dialog')
  zoomLayer.setAttribute('aria-label', image.alt || '查看图片')
  zoomLayer.setAttribute('aria-modal', 'true')
  zoomLayer.tabIndex = -1
  const full = document.createElement('img')
  full.src = image.currentSrc || image.src
  full.alt = image.alt || ''
  zoomLayer.append(full)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'icon-btn zoom-close'
  close.setAttribute('aria-label', '关闭图片预览')
  close.innerHTML = icon('close', 20)
  zoomLayer.append(close)
  zoomLayer.addEventListener('click', closeZoom)
  document.body.append(zoomLayer)
  document.body.style.overflow = 'hidden'
  close.focus()
}
document.addEventListener('click', event => {
  if (event.target.closest('.img-zoom')) return
  if (event.target.closest('.quick-lesson')) return
  const preview = event.target.closest('[data-image-preview]')
  if (preview) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openZoom({ src: preview.href, alt: preview.dataset.previewAlt || '已提交截图' })
    return
  }
  const image = event.target.closest('.markdown p > img:only-child')
  if (image && image.naturalWidth) openZoom(image)
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeZoom()
  if (zoomLayer && event.key === 'Tab') {
    event.preventDefault()
    zoomLayer.querySelector('button').focus()
  }
})

document.addEventListener('paste', async event => {
  if (!state.current?.stage || state.quick || dialog.open || zoomLayer
    || !main.querySelector('[data-form="upload"][data-kind="screenshot"] input[type="file"]')) return
  const items = [...(event.clipboardData?.items ?? [])]
  const image = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
  if (!image) return
  const typing = event.target.closest?.('input, textarea, [contenteditable="true"]')
  if (typing && event.clipboardData.getData('text/plain')) return
  event.preventDefault()
  if (!requireLogin()) return
  try {
    await pasteScreenshot(image, screenshotOptions(state.current))
  } catch (error) {
    announce(error.message, true)
  }
})

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
  if (state.quick && input.matches('[data-quick-title], [data-quick-task], [data-quick-alias], [data-quick-property]')) {
    const editor = state.quick
    if (input.matches('[data-quick-title]')) {
      if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/[\r\n]+/g, ' ')
      editor.title = input.value
      fitQuickTitle()
    } else if (input.matches('[data-quick-alias]')) editor.alias = input.value
    else if (input.matches('[data-quick-task]')) editor.task = input.value
    else {
      const block = editor.blocks.find(block => block.id === input.closest('[data-quick-block]').dataset.quickBlock)
      const property = input.dataset.quickProperty
      if (property === 'enabled' || property === 'required') {
        const kind = block.type === 'question' ? block.fieldKey : block.type
        const list = property === 'enabled' ? 'enabled' : block.type === 'question' ? 'requiredFields' : 'required'
        editor[list] = editor[list].filter(value => value !== kind)
        if (input.checked) editor[list].push(kind)
        if (property === 'enabled' && !input.checked) editor.required = editor.required.filter(value => value !== kind)
        const container = input.closest('[data-quick-block]')
        container.outerHTML = quickBlock(block, editor, editor.blocks.indexOf(block))
      } else updateBlock(block, input)
    }
    if (!event.isComposing) queueQuickLesson()
    return
  }
  if (input.matches('[data-prerequisite-mode]')) {
    const requirement = state.editor.prerequisites.find(item => item.courseId === input.dataset.id)
    requirement.mode = input.value
  }
  if (!event.isComposing && ['course', 'course-lesson'].includes(input.form?.dataset.form)) queueCourseDraft(input.form)
  if (input.matches('[data-form="course-sharing"] select[name="mode"]')) {
    dialog.querySelector('[data-collaborator-picker]').hidden = input.value !== 'shared'
    dialog.querySelector('[data-public-sharing-note]').hidden = input.value !== 'public'
  }
  if (input.matches('[data-wish-course-filter]')) {
    const query = input.value.trim().toLowerCase()
    const choices = [...dialog.querySelectorAll('[data-action="wish-attach"]')]
    for (const course of choices) course.hidden = !course.textContent.toLowerCase().includes(query)
    dialog.querySelector('[data-wish-picker-empty]').hidden = choices.some(course => !course.hidden)
  }
  if (input.matches('[data-stage-filter]')) {
    for (const option of dialog.querySelectorAll('.stage-option')) {
      option.hidden = !option.textContent.toLowerCase().includes(input.value.trim().toLowerCase())
    }
  }
  const askBox = input.closest?.('[data-ask-field]')
  if (askBox) scheduleAskSave(askBox)
  if (input.matches('input[name="methods"]') && input.form?.querySelector('input[name="required"]')) {
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

document.addEventListener('focusout', event => {
  if (!state.quick || !event.target.matches('[data-quick-property="text"]')) return
  const container = event.target.closest('[data-quick-block]')
  if (container.contains(event.relatedTarget)) return
  const editor = state.quick
  const block = editor.blocks.find(block => block.id === container.dataset.quickBlock)
  container.outerHTML = quickBlock(block, editor, editor.blocks.indexOf(block))
})

// iOS Safari 忽略 user-scalable=no，用 gesture 事件挡住双指缩放。
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, event => event.preventDefault(), { passive: false })
}

dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close()
})
dialog.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('[data-collaborator-search]')) {
    event.preventDefault()
    dialog.querySelector('[data-action="find-collaborators"]').click()
  }
})
window.addEventListener('beforeunload', event => {
  if (!state.editor?.autosave?.dirty() && !state.quick?.autosave.dirty()) return
  event.preventDefault()
  event.returnValue = ''
})
window.addEventListener('popstate', () => navigate())
accountEvents?.addEventListener('message', () => {
  identityRevision++
  state.editor?.autosave?.discard()
  state.quick?.autosave.discard()
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
