import { icon } from './icons.js'
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
const productName = '知行谱'
const state = { user: null, hosted: false, path: '', category: '', query: '', current: null, editor: null }
let navigation = 0
let toastTimeout

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

function login(mode = 'login') {
  if (state.hosted) {
    const returnTo = /^\/(?!\/)/.test(location.pathname) ? location.pathname : '/'
    showDialog(`登录${productName}`, `<p>使用 ChatGPT 账号保存你的学习进度、提交作业和创建课程。</p>
      <a class="btn primary" href="/signin-with-chatgpt?return_to=${key(returnTo)}" target="_top">使用 ChatGPT 登录</a>`)
    return
  }
  const register = mode === 'register'
  showDialog(register ? '创建账号' : `登录${productName}`, `<form data-form="auth" data-mode="${mode}">
    ${register ? '<label>昵称<input name="name" maxlength="40" autocomplete="nickname" required></label>' : ''}
    <label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="32" required></label>
    <label>密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" required></label>
    <div class="form-error" role="alert" hidden></div><div class="submit-row">
      ${button(register ? 'login' : 'register', register ? '已有账号，去登录' : '没有账号，去注册', 'text-btn')}
      <button class="btn primary">${register ? '注册' : '登录'}</button></div></form>`)
  dialog.querySelector('input')?.focus()
}

function requireLogin() {
  if (state.user) return true
  login()
  return false
}

function account() {
  if (!requireLogin()) return
  showDialog('我的账号', `<p class="account-name"><span class="avatar">${esc(state.user.name.slice(0, 1))}</span> ${esc(state.user.name)}</p>
    ${state.hosted ? '<a class="btn" href="/signout-with-chatgpt?return_to=%2F" target="_top">退出登录</a>'
      : button('logout', '退出登录')}`)
}

function showMcp() {
  if (state.hosted) {
    showDialog('MCP 连接', `<p>在 ChatGPT 或 Codex 的「插件 → 个人 → 由你创建」中连接${productName}。</p>
      <p>让助手先列出关卡，再为你创建课程。例如：</p>
      <blockquote>列出关卡库中可引用的关卡，把「配置大模型 API」加入一门叫「AI 视频练习」的私有课程。</blockquote>`)
    return
  }
  showDialog('MCP 连接', `<p>在支持 Streamable HTTP 的 MCP 客户端中使用下方地址，添加 <code>Authorization: Bearer &lt;令牌&gt;</code> 请求头。</p>
    <label>MCP 地址<input readonly value="${esc(location.origin)}/mcp"></label>
    <div class="inline-actions">${button('token', '生成或轮换令牌', 'btn primary', 'plug')}${button('revoke', '撤销令牌')}</div>
    <div data-token-result></div>`)
}

function paintShell() {
  const sections = [
    ['学习', [['/', '探索课程', 'compass'], ['/learning', '我的学习', 'book']]],
    ['创作', [['/owned', '我的创作', 'grid'], ['/stages', '关卡库', 'layers']]],
  ]
  const active = state.path === '/' || /^\/course\/[^/]+(?:\/stage\/[^/]+)?$/.test(state.path)
    ? '/' : state.path.startsWith('/stage/') ? '/stages'
      : state.path.startsWith('/course/') ? '/owned' : state.path
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
  main.innerHTML = `<div class="page-heading section-head"><div><h1>关卡库</h1>
    <p>浏览可复用的公开关卡，或创建你的独立关卡。</p></div>${button('new-stage', '新建关卡', 'btn primary', 'plus')}</div>
    <div class="stage-grid">${stages.map(stage => `<a class="library-stage" data-link href="${stagePath(stage.id)}">
      <span class="library-icon">${icon('layers', 22)}</span><span class="step-text"><strong>${esc(stage.title)}</strong>
      <small>${esc(stage.task)}</small><small>${esc(stage.author)} · ${stage.visibility === 'public' ? '公开' : '私有'}</small></span>
      ${icon('arrow', 16)}</a>`).join('') || note('还没有可用关卡。')}</div>`
}

async function navigate(path = location.pathname, push = false) {
  if (push && path !== location.pathname) history.pushState({}, '', path)
  const version = ++navigation
  state.path = path
  state.current = null
  state.editor = null
  document.body.classList.remove('menu-open')
  if (dialog.open) dialog.close()
  paintShell()
  main.innerHTML = '<p class="loading">正在加载…</p>'
  window.scrollTo(0, 0)
  try {
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
    if (!parts.length) {
      const courses = await api('courses')
      if (version !== navigation) return
      state.current = { courses }
      paintExplore(courses)
    } else if (['learning', 'owned'].includes(parts[0]) && parts.length === 1) {
      const scope = parts[0] === 'owned' ? 'owned' : 'joined'
      const courses = state.user ? await api('courses?scope=' + scope) : []
      if (version !== navigation) return
      courseShelf(courses, scope)
    } else if (parts[0] === 'stages' && parts.length === 1) {
      const stages = await api('stages')
      if (version !== navigation) return
      stagesPage(stages)
    } else if (path === '/course/new' || (parts[0] === 'course' && parts[2] === 'edit' && parts.length === 3)) {
      if (!state.user) {
        main.innerHTML = `<div class="sign-in-panel">${note('登录后可以创建和编辑课程。', 'lock')}${button('login', '登录', 'btn primary')}</div>`
        return
      }
      const [course, available] = await Promise.all([
        path === '/course/new' ? null : api('courses/' + key(parts[1])),
        api('stages'),
      ])
      if (version !== navigation) return
      if (course && !course.owned) throw new Error('只有课程作者可以编辑课程。')
      state.editor = { course, available, ids: course?.stages.map(stage => stage.id) ?? [] }
      main.innerHTML = courseEditor(state.editor)
    } else if (parts[0] === 'course' && parts.length === 2) {
      const course = await api('courses/' + key(parts[1]))
      if (version !== navigation) return
      state.current = { course }
      main.innerHTML = coursePage(course, state.user)
    } else if ((parts[0] === 'stage' && parts.length === 2) ||
        (parts[0] === 'course' && parts[2] === 'stage' && parts.length === 4)) {
      const [course, stage] = await Promise.all([
        parts.length === 4 ? api('courses/' + key(parts[1])) : null,
        api('stages/' + key(parts.at(-1))),
      ])
      if (version !== navigation) return
      if (course && !course.stages.some(item => item.id === stage.id)) throw new Error('这门课程未引用该关卡。')
      state.current = { course, stage }
      main.innerHTML = stagePage(stage, course)
    } else {
      throw new Error('页面不存在。')
    }
    document.title = `${main.querySelector('h1')?.textContent ?? '学习'} · ${productName}`
  } catch (error) {
    if (version !== navigation) return
    main.innerHTML = `<div class="sign-in-panel">${note(error.message, 'close')}${link('/', '返回课程首页')}</div>`
  }
}

function paintPicked() {
  main.querySelector('[data-picked-stages]').innerHTML = pickedStages(state.editor)
}

function chooseStageDialog() {
  const entries = state.editor.available.filter(stage => !state.editor.ids.includes(stage.id))
  showDialog('引用已有的关卡', `<label>搜索关卡<input type="search" placeholder="输入名称或作者" data-stage-filter></label>
    <p class="subtle">可以引用公开关卡，以及你自己创建的私有关卡。</p>
    <div class="stage-options">${entries.map(stage => `<button type="button" class="stage-option" data-action="attach-stage" data-id="${esc(stage.id)}">
      <span class="step-text"><strong>${esc(stage.title)}</strong><small>${esc(stage.author)}</small></span>
      ${visibility(stage.visibility)}${icon('plus', 17)}</button>`).join('') || note('没有更多可引用的关卡。')}</div>`, true)
}

function applyStage(stage, kind, context) {
  if (context !== state.current) return
  context.stage = stage
  main.querySelector('[data-stage-stats]').innerHTML = stageStats(stage)
  const slot = main.querySelector(`[data-submission="${kind}"]`)
  const focused = slot.contains(document.activeElement)
  slot.innerHTML = submission(stage, kind)
  if (focused) slot.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  if (context.course) {
    const { course } = context
    course.stages.find(item => item.id === stage.id).learned = stage.learned
    course.completedCount = course.stages.filter(item => item.learned).length
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
    case 'logout':
      await api('auth/logout', { method: 'POST' })
      state.user = null
      await navigate('/', true)
      break
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
        ? `<label>个人令牌<input readonly value="${esc(result.token)}" data-token-input></label><p class="subtle">令牌只在创建时显示。轮换后，旧令牌立即失效。</p>`
        : '<p class="subtle" role="status">令牌已撤销。</p>'
      dialog.querySelector('[data-token-input]')?.select()
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
        const { course } = state.current
        await api('courses/' + key(course.id) + '/join', { method: 'POST' })
        await navigate()
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
    case 'attach-stage':
      state.editor.ids.push(id)
      dialog.close()
      paintPicked()
      break
    case 'remove-stage':
      state.editor.ids = state.editor.ids.filter(stageId => stageId !== id)
      paintPicked()
      break
    case 'move-up':
    case 'move-down': {
      const ids = state.editor.ids
      const i = ids.indexOf(id)
      const j = i + (action === 'move-up' ? -1 : 1)
      if (i >= 0 && j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]]
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
      const result = await api('auth/' + form.dataset.mode, { method: 'POST', body })
      state.user = result.user
      await navigate()
      announce('已登录。')
      break
    }
    case 'course': {
      const { course, ids } = state.editor
      const saved = await api('courses' + (course ? '/' + key(course.id) : ''), {
        method: course ? 'PUT' : 'POST', body: { ...body, stageIds: ids },
      })
      await navigate(coursePath(saved.id), true)
      announce(course ? '课程已保存。' : '课程已创建。')
      break
    }
    case 'stage': {
      const id = form.dataset.id
      const saved = await api('stages' + (id ? '/' + key(id) : ''), {
        method: id ? 'PUT' : 'POST', body: { ...body, methods: data.getAll('methods') },
      })
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

document.addEventListener('click', async event => {
  const link = event.target.closest('a[data-link]')
  if (link && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    if (link.pathname === '/') {
      state.query = ''
      state.category = ''
    }
    await navigate(link.pathname, true)
    main.focus({ preventScroll: true })
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
try {
  const { user, hosted } = await api('me')
  state.user = user
  state.hosted = hosted
  await navigate()
} catch (error) {
  paintShell()
  main.innerHTML = note(error.message, 'close')
}
