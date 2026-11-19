import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { COURSE_LABELS, kindLabels, LABELS } from '../shared.js'
import { icon } from './icons.js'
import { contentWidget, layoutTutorial, submissionKinds } from './tutorial.js'

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const key = encodeURIComponent
export const categories = ['AI 创作', '编程开发', '效率工具', '产品设计', '其他']
export const themes = { violet: '紫色', peach: '暖橙', blue: '蓝色', mint: '绿色' }
export const methods = {
  learned: [LABELS.learned, 'check'],
  answer: [LABELS.answer, 'text'],
  screenshot: [LABELS.screenshot, 'image'],
  file: [LABELS.file, 'file'],
}
export const coursePath = course => '/course/' + key(typeof course === 'string' ? course : course.alias || course.id)
export function stagePath(id, course) {
  const alias = course?.stages?.find(stage => stage.id === id)?.alias
  return course ? coursePath(course) + '/stage/' + key(alias || id) : '/stage/' + key(id)
}
export const link = (url, label, style = 'btn', symbol) =>
  `<a class="${style}" href="${esc(url)}" data-link>${symbol ? icon(symbol, 17) : ''}${label}</a>`
export const button = (action, label, style = 'btn', symbol, attrs = '') =>
  `<button type="button" class="${style}" data-action="${action}" ${attrs}>${symbol ? icon(symbol, 17) : ''}${label}</button>`
export const note = (text, symbol = 'layers') => `<div class="empty">${icon(symbol, 27)}<p>${esc(text)}</p></div>`

function theme(course) {
  return Object.hasOwn(themes, course.theme) ? course.theme : 'violet'
}

function topicIcon(course) {
  if (course.id === 'ai-video') return 'video'
  return ({ 'AI 创作': 'image', '编程开发': 'code', '效率工具': 'pen', '产品设计': 'target' })[course.category] ?? 'layers'
}

// 课程标签徽标：编写中 / 完结 / 期待共创 / 精品（管理员）
export function labelBadges(labels = []) {
  return (labels ?? []).map(key => {
    const meta = COURSE_LABELS[key]
    return meta ? `<span class="label label-${key}">${esc(meta.name)}</span>` : ''
  }).join('')
}

export function visibility(value) {
  return `<span class="visibility">${icon(value === 'public' ? 'globe' : 'lock', 14)}${value === 'public' ? '公开' : '私有'}</span>`
}

export function progress(course) {
  return `<div class="progress"><div><span>学习进度</span><strong>${course.completedCount} / ${course.stageCount}</strong></div>
    <progress value="${course.completedCount}" max="${course.stageCount || 1}" aria-label="学习进度"></progress></div>`
}

export function card(course, scope) {
  return `<a class="course-card" href="${coursePath(course)}" data-link>
    <div class="card-cover theme-${theme(course)}"><span class="cover-icon">${icon(topicIcon(course), 28)}</span><span class="cover-orbit"></span></div>
    <div class="card-content">
      <div class="card-tag">${esc(course.category)}${labelBadges(course.labels)}${scope === 'owned' ? visibility(course.visibility) : ''}${scope === 'owned' && !course.owned ? '<span class="visibility">协作课程</span>' : ''}${course.moderated_at ? '<span class="visibility">已下架</span>' : ''}</div>
      <h3>${esc(course.title)}</h3>
      <p>${esc(course.description)}</p>
      ${scope === 'joined' ? progress(course) : ''}
      <div class="card-footer"><span>${icon('layers', 15)} ${course.stageCount} 个关卡</span><span>${icon('users', 15)} ${course.learnerCount} 人学习</span>${icon('arrow', 16)}</div>
    </div></a>`
}

export function hero(course) {
  return `<section class="hero">
    <div class="hero-copy">
      <div class="hero-label">${icon('spark', 16)} 推荐课程</div>
      <h2>${esc(course.title)}</h2><p>${esc(course.description)}</p>
      <a class="btn primary" href="${coursePath(course)}" data-link>开始学习 ${icon('arrow', 17)}</a>
      <span class="hero-meta">${icon('layers', 16)} ${course.stageCount} 个实战关卡</span>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="hero-grid"></div><div class="hero-halo"></div>
      <div class="orbit-line orbit-a"></div><div class="orbit-line orbit-b"></div>
      <div class="art-card art-back"></div><div class="art-card art-middle"></div>
      <div class="art-card art-front"><i></i><b></b><span class="art-sun"></span></div>
      <div class="art-glint glint-a">${icon('spark', 28)}</div><div class="art-glint glint-b">${icon('spark', 16)}</div>
    </div>
  </section>`
}

export function coursePage(course, user) {
  const next = course.learningLocked ? null : course.stages.find(stage => !stage.learned) ?? course.stages[0]
  return `<p class="breadcrumb">${link('/', '探索课程', 'back', 'left')}</p>
    <section class="course-intro theme-${theme(course)}">
      <div class="cover-icon">${icon(topicIcon(course), 30)}</div>
      <div class="intro-main">
        <div class="card-tag">${esc(course.category)}${labelBadges(course.labels)}${visibility(course.visibility)}${course.moderated_at ? '<span class="visibility">已下架</span>' : ''}</div>
        <h1>${esc(course.title)}</h1>
      </div>
      <div class="intro-actions">
        ${next ? link(stagePath(next.id, course), course.completedCount ? '继续学习' : '开始学习', 'btn primary', 'play') : ''}
        ${!course.learningLocked && !course.joined && !course.owned ? button('join', '加入我的学习', 'btn', 'plus') : ''}
        ${course.canEdit ? link(coursePath(course) + '/edit', '编辑课程', 'btn', 'pen') : ''}
      </div>
      <p class="course-description">${esc(course.description)}</p>
      <div class="intro-meta"><span>${icon('user', 16)}${esc(course.author)}</span><span>${icon('layers', 16)}${course.stageCount} 个关卡</span><span>${icon('users', 16)}${course.learnerCount} 人学习</span></div>
    </section>
    ${prerequisitePanel(course)}
    <section class="outline-card">
      <div class="section-head"><h2>课程关卡</h2><span class="subtle">${course.stageCount} 个关卡</span></div>
      ${user && course.stageCount ? progress(course) : ''}
      ${outline(course)}
    </section>`
}

function prerequisitePanel(course) {
  if (!course.prerequisites?.length) return ''
  return `<section class="outline-card prerequisite-panel">
    <div class="section-head"><h2>前置课程</h2>
      ${course.learningLocked ? '<span class="visibility">' + icon('lock', 15) + ' 当前课程未解锁</span>' : ''}
    </div>
    ${course.learningLocked ? '<p>先完成必修的前置课程，标记其中的全部关卡为「学会了」，即可解锁本课程。</p>' : ''}
    <ul class="prerequisite-list">${course.prerequisites.map(item => `<li>
      <div class="step-text"><strong>${esc(item.title ?? '前置课程暂不可访问')}</strong>
        <small>${item.mode === 'required' ? '必修' : '建议 · 可跳过'} · ${item.completed ? '已完成' : '未完成'}</small></div>
      ${item.title ? link(coursePath(item.alias || item.courseId), item.completed ? '查看课程' : '去学习', 'btn', 'arrow') : ''}
    </li>`).join('')}</ul>
  </section>`
}

export function outline(course, active) {
  const titles = new Map(course.stages.map(stage => [stage.id, stage.title]))
  return course.stages.length ? `<ol class="outline">${course.stages.map((stage, i) => {
    const waiting = (stage.requires ?? []).filter(id => !course.stages.find(item => item.id === id)?.learned)
    const locked = Boolean(course.learningLocked) || Boolean(stage.locked)
    const hint = course.learningLocked ? '先学完前置课程' : `需先学会：${waiting.map(id => titles.get(id) ?? id).join('、')}`
    const contents = `
      <span class="step-number ${stage.learned ? 'done' : ''}">${stage.learned ? icon('check', 16) : i + 1}</span>
      <span class="step-text"><strong>${esc(stage.title)}</strong>${active || locked ? '' : `<small>${esc(stage.task)}</small>`}${stage.locked && !course.learningLocked ? `<small>${esc(hint)}</small>` : ''}</span>
      ${icon(locked ? 'lock' : 'chevron', 16)}`
    return `<li>${locked ? `<div class="locked-step">${contents}</div>`
      : `<a href="${stagePath(stage.id, course)}" data-link ${active === stage.id ? 'aria-current="page"' : ''}>${contents}</a>`}</li>`
  }).join('')}</ol>` : note('这门课还没有关卡。')
}

export function stageStats(stage) {
  return `<span class="stat-main">${icon('users', 17)} <strong>${stage.stats.participants}</strong> 人参与</span>
    ${Object.entries(methods).filter(([kind]) => stage.methods.includes(kind) || stage.stats[kind]).map(([kind, [label]]) =>
      `<span>${esc(label)} <strong>${stage.stats[kind]}</strong></span>`).join('')}`
}

export function submission(stage, kind, prompt = '') {
  if (kind === 'learned') {
    const missing = [...(stage.missing ?? []), ...(stage.missingFields ?? [])]
    const blocked = !stage.learned && missing.length > 0
    const label = stage.learned ? '已学会 · 撤销' : blocked ? '请先完成必填项' : '标记学会了'
    const attrs = blocked ? `disabled title="必填提交：${esc(kindLabels(missing))} 尚未完成"` : ''
    return button('learned', label, stage.learned ? 'btn done' : 'btn', 'check', attrs)
      + `<small class="participation-count learned-count">已有 ${stage.stats?.learned ?? 0} 人学会</small>`
      + (blocked ? `<p class="submit-hint">必填：${esc(kindLabels(missing))}</p>` : '')
  }
  const current = stage.submissions.find(entry => entry.kind === kind)
  const allowed = stage.methods.includes(kind)
  if (!current && !allowed) return ''
  const required = stage.required?.includes(kind)
  const [label, symbol] = methods[kind]
  const uploaded = `/api/stages/${key(stage.id)}/upload/${kind}`
  const preview = uploaded + '?preview=1&v=' + key(current?.updated_at ?? '')
  const title = `<div class="submit-title">${icon(symbol, 19)}<h3>${label}</h3>${required ? '<span class="saved required">必填</span>' : ''}${current ? '<span class="saved">已提交</span>' : ''}
      <small class="participation-count">已有 ${stage.stats?.[kind] ?? 0} 人提交</small></div>`
    + (prompt ? `<p class="submit-prompt">${esc(prompt)}</p>` : '')
    + (required && !current ? '<p class="submit-hint">这是必填提交，完成后才能标记学会了。</p>' : '')
  if (kind === 'answer') {
    return `<form class="submission" data-form="answer">${title}
      <textarea name="answer" aria-label="文本答案" maxlength="20000" rows="4" placeholder="写下你的练习答案或学习记录…" required ${allowed ? '' : 'readonly'}>${esc(current?.answer)}</textarea>
      ${allowed ? `<div class="submit-row"><button class="btn primary">${current ? '保存修改' : '提交答案'}</button></div>` : ''}
    </form>`
  }
  return `<form class="submission" data-form="upload" data-kind="${kind}">${title}
    ${current ? `<div class="existing-file">${kind === 'screenshot'
      ? `<a href="${esc(preview)}" data-image-preview data-preview-alt="${esc(current.filename)}" aria-label="放大预览已提交截图"><img src="${esc(preview)}" alt="已提交截图"></a>
        <a href="${esc(preview)}" data-image-preview data-preview-alt="${esc(current.filename)}">${esc(current.filename)}</a>`
      : `${icon('file', 18)}<a href="${uploaded}">${esc(current.filename)}</a>`}</div>` : ''}
    ${allowed ? `<div class="upload-row"><label class="file-picker">${icon('upload', 18)}<span>选择${kind === 'screenshot' ? '截图' : '文件'}</span>
      <input type="file" name="upload" ${kind === 'screenshot' ? 'accept="image/png,image/jpeg,image/webp,image/gif"' : ''} required></label>
      ${kind === 'screenshot' ? button('capture-screen', '截取屏幕', 'btn capture-screen', 'image') : ''}
      <span class="file-label subtle">最多 10 MB</span><button class="btn upload-submit">${current ? '替换上传' : '提交上传'}</button></div>` : ''}
    ${allowed && kind === 'screenshot' ? '<p class="paste-hint" data-screenshot-paste tabindex="0">也可以直接按 Ctrl+V 粘贴图片，预览后上传。</p>' : ''}
  </form>`
}

function submissionSlot(stage, kind, prompt) {
  return `<div data-submission="${kind}">${submission(stage, kind, prompt)}</div>`
}

// 教程里的 {{ask:问题}}：窄输入框；带选项时是单选，选「其他」再自己填。
function askSlot(stage, field, signedIn = true) {
  const fieldKey = field.key ?? field.name
  const required = stage.requiredFields?.includes(fieldKey)
  const answer = (stage.answers ?? []).find(item => item.field === fieldKey)?.value ?? ''
  const choice = field.options.length > 0
  const matched = choice && field.options.includes(answer)
  const others = choice && answer && !matched
  const selected = matched ? answer : others ? '其他' : ''
  const count = stage.fieldStats?.find(item => item.field === fieldKey)?.count ?? 0
  const participants = `<small class="participation-count" data-field-count>已有 ${count} 人填写</small>`
  if (!signedIn) {
    return `<div class="ask-field ${answer ? 'filled' : ''}" data-ask-field data-field="${esc(fieldKey)}" data-kind="locked">
      <div class="ask-title"><span class="ask-label">${icon('text', 15)} ${esc(field.name)}</span>${participants}</div>
      <p class="subtle">登录后可以在这里填写。</p>
    </div>`
  }
  return `<div class="ask-field ${answer ? 'filled' : ''}" data-ask-field data-field="${esc(fieldKey)}" data-kind="${choice ? 'choice' : 'text'}">
    <div class="ask-title"><span class="ask-label">${icon('text', 15)} ${esc(field.name)} ${required ? '<span class="saved required">必填</span>' : ''}<span class="saved ask-saved">已填</span></span>${participants}</div>
    ${choice
      ? `<select data-ask-select aria-label="${esc(field.name)}">
          <option value="">请选择</option>
          ${field.options.map(option => `<option value="${esc(option)}" ${option === selected ? 'selected' : ''}>${esc(option)}</option>`).join('')}
          <option value="其他" ${selected === '其他' ? 'selected' : ''}>其他…</option>
        </select>
        <input data-ask-custom aria-label="${esc(field.name)}自定义内容" maxlength="2000" placeholder="写你自己的一类" value="${esc(others ? answer : '')}" ${others ? '' : 'hidden'}>`
      : `<input data-ask-text aria-label="${esc(field.name)}" maxlength="2000" placeholder="简短写一下" value="${esc(answer)}">`}
  </div>`
}

export function markdownBlock(html) {
  let safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'style', 'iframe'],
    FORBID_ATTR: ['style', 'id', 'class'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target', 'rel'],
  })
  // 教程里的外链一律新标签页打开，别把课程页顶掉。
  safe = safe.replace(/<a (?![^>]*\btarget=)/g, '<a target="_blank" rel="noopener noreferrer" ')
  // 宽表格在窄屏上横向滚动，而不是把整页撑开
  const tables = safe.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')
  const copyable = tables.replace(/<pre>([\s\S]*?)<\/pre>/g, (_, code) =>
    `<div class="code-sample" data-copy-source><div class="code-sample-head"><span>可复制内容</span>${button('copy-snippet', '复制', 'text-btn', 'copy', 'data-copy-label="复制" aria-live="polite"')}</div><pre tabindex="0">${code}</pre></div>`)
  return `<div class="markdown">${copyable}</div>`
}

export function lessonWidget(widget, depth = 0) {
  if (widget.type === 'prompt') {
    return `<section class="prompt-card" data-copy-source><div class="prompt-head"><h3>${icon('spark', 18)}<span>${esc(widget.title || '提示词')}</span></h3>
      ${button('copy-snippet', '复制提示词', 'btn prompt-copy', 'copy', `data-copy-label="复制提示词" aria-live="polite" ${widget.content ? '' : 'disabled'}`)}</div>
      <pre tabindex="0"><code>${esc(widget.content)}</code></pre></section>`
  }
  return `<details class="lesson-fold"><summary>${icon('chevron', 17)}<span>${esc(widget.title || '补充说明')}</span><small class="fold-hint" aria-hidden="true"></small></summary>
    <div class="fold-body">${depth < 8 ? renderLessonMarkdown(widget.content, depth + 1) : markdownBlock(marked.parse(widget.content))}</div></details>`
}

export function renderLessonMarkdown(markdown, depth = 0) {
  const tokens = marked.lexer(markdown)
  const result = []
  let start = 0
  for (let index = 0; index < tokens.length; index++) {
    const widget = contentWidget(tokens[index])
    if (!widget) continue
    const html = marked.parser(tokens.slice(start, index))
    if (html.trim()) result.push(markdownBlock(html))
    result.push(lessonWidget(widget, depth))
    start = index + 1
  }
  const html = marked.parser(tokens.slice(start))
  if (html.trim()) result.push(markdownBlock(html))
  return result.join('')
}

function tutorialPanel(stage, signedIn) {
  const kinds = submissionKinds.filter(kind => stage.methods.includes(kind) || stage.submissions.some(entry => entry.kind === kind))
  if (!stage.tutorial) {
    return kinds.length ? `<section class="lesson-panel"><h2>${icon('upload', 20)} 练习提交</h2>
      ${kinds.map(kind => submissionSlot(stage, kind)).join('')}</section>` : ''
  }

  const { blocks } = layoutTutorial(stage.tutorial, kinds)
  const content = blocks.map(block => block.widget ? lessonWidget(block.widget) : block.kind ? submissionSlot(stage, block.kind, block.prompt)
    : block.field ? askSlot(stage, block.field, signedIn) : markdownBlock(block.html)).join('')
  // 提交框只出现在作者手动占位的位置；没写 {{submit:...}} 就不显示任何提交框。
  return `<section class="lesson-panel lesson-tutorial"><h2>${icon('book', 20)} 教程</h2>
    ${blocks.some(block => block.kind) ? '<p class="subtle submission-intro">看到提交框就可以填写，也可以之后回来修改。</p>' : ''}
    ${content}
  </section>`
}

// 「标记学会了」在教程末尾再放一次：learned 是每个关卡都有的方式，不依赖有没有作业提交。
function finishPanel(stage) {
  const hint = stage.required?.length || stage.requiredFields?.length
    ? '完成必填提交后，点右边的按钮记录学习进度。'
    : '点右边的按钮记录学习进度，之后随时可以回来撤销。'
  return `<section class="lesson-panel lesson-finish">
    <div><h2>${icon('check', 20)} 学完这一关了吗？</h2>
      <p class="subtle">${hint}</p></div>
    <div data-submission="learned">${submission(stage, 'learned')}</div>
  </section>`
}

// 关卡底部的笔记/讨论：笔记可选公开或私有，公开的其他人可以回复。
export function notesPanel(notes = [], canWrite = false) {
  const time = value => esc(String(value ?? '').slice(0, 16).replace('T', ' '))
  const noteItem = note => `<li class="note" data-note="${esc(note.id)}">
    <div class="note-head"><strong>${esc(note.author ?? '我')}</strong>
      <span class="note-meta">${time(note.created_at)} · ${note.visibility === 'private' ? '仅自己可见' : '公开'}</span>
      ${note.mine ? `<span class="note-tools">
        ${button('note-visibility', note.visibility === 'private' ? '改为公开' : '改为仅自己', 'text-btn', null, `data-id="${esc(note.id)}" data-next="${note.visibility === 'private' ? 'public' : 'private'}"`)}
        ${button('note-delete', '删除', 'text-btn', null, `data-id="${esc(note.id)}"`)}</span>` : ''}</div>
    <p class="note-body">${esc(note.body)}</p>
    ${note.replies?.length ? `<ul class="note-replies">${note.replies.map(reply => `<li>
      <strong>${esc(reply.author ?? '我')}</strong>
      <span class="note-meta">${time(reply.created_at)}</span>
      <p class="note-body">${esc(reply.body)}</p></li>`).join('')}</ul>` : ''}
    ${canWrite && note.visibility === 'public' ? `<form class="note-reply" data-form="reply" data-parent="${esc(note.id)}">
      <input name="body" maxlength="2000" placeholder="回复…" aria-label="回复这条笔记" required>
      <button class="btn">回复</button></form>` : ''}
  </li>`
  return `<section class="lesson-panel notes-panel" data-notes>
    <h2>${icon('book', 20)} 笔记与讨论 <span class="subtle">${notes.length} 条</span></h2>
    ${canWrite ? `<form class="note-form" data-form="note">
      <textarea name="body" rows="3" maxlength="2000" placeholder="写下你的笔记，或者问一个问题…" aria-label="笔记内容" required></textarea>
      <div class="note-actions">
        <select name="visibility" aria-label="可见性">
          <option value="public">公开 · 其他人可见并回复</option>
          <option value="private">仅自己可见 · 当作私人笔记</option>
        </select>
        <button class="btn primary">发布</button>
      </div>
    </form>` : '<p class="subtle">登录后可以写笔记、参与讨论。</p>'}
    ${notes.length ? `<ul class="note-list">${notes.map(noteItem).join('')}</ul>`
      : canWrite ? '<p class="subtle">还没有笔记。写下你的想法，公开的笔记其他人可以回复。</p>' : ''}
  </section>`
}

export function stagePage(stage, course, entry, signedIn) {
  const number = course ? course.stages.findIndex(item => item.id === stage.id) + 1 : null
  const titles = new Map((course?.stages ?? []).map(item => [item.id, item.title]))
  const waiting = (entry?.requires ?? [])
    .filter(id => !course.stages.find(item => item.id === id)?.learned)
    .map(id => titles.get(id) ?? id)
  const locked = Boolean(entry?.locked)
  const lesson = locked ? `<article class="lesson">
      <header class="lesson-header">
        <div class="lesson-kicker">${icon('lock', 17)} 关卡 ${number} / ${course.stageCount}</div>
        <div class="section-head"><h1>${esc(stage.title)}</h1></div>
      </header>
      <section class="locked-panel">${icon('lock', 27)}
        <h2>关卡尚未解锁</h2>
        <p>先学会${waiting.map(title => `「${esc(title)}」`).join('、')}，再回到这里继续。</p>
        ${link(coursePath(course), '返回课程关卡', 'btn primary', 'layers')}
      </section>
    </article>` : `<article class="lesson">
        <header class="lesson-header">
          <div class="lesson-kicker">${icon('layers', 17)} ${course ? `关卡 ${number} / ${course.stageCount}` : '独立关卡'}</div>
          <div class="section-head"><h1>${esc(stage.title)}</h1>${course?.canEdit
            ? button('quick-lesson', '快速编辑', 'btn', 'pen')
            : stage.owned ? button('edit-stage', '编辑', 'btn', 'pen', `data-id="${esc(stage.id)}"`) : ''}</div>
          <div class="lesson-status"><div class="stats" data-stage-stats>${stageStats(stage)}</div>${submissionSlot(stage, 'learned')}</div>
        </header>
        <section class="task-box"><h2>${icon('target', 20)} 学习任务</h2><p>${esc(stage.task)}</p></section>
        ${tutorialPanel(stage, signedIn)}
        ${finishPanel(stage)}
      </article>`
  return `<p class="breadcrumb">${course ? link(coursePath(course), esc(course.title), 'back', 'left') : link('/stages', '我的关卡', 'back', 'left')}</p>
    <div class="learning-layout ${course ? '' : 'standalone'}">
      ${lesson}
      ${course ? `<aside class="lesson-outline"><h2>本课关卡</h2><div data-outline>${progress(course)}${outline(course, stage.id)}</div></aside>` : ''}
      ${notesPanel(stage.notes ?? [], Boolean(stage.noteCanWrite))}
    </div>`
}

const options = (choices, selected) => choices.map(([value, name]) =>
  `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(name)}</option>`).join('')
const visOptions = value => options([['private', '私有'], ['public', '公开']], value)

export function pickedStages(editor) {
  const titles = new Map(editor.available.map(stage => [stage.id, stage.title]))
  const position = new Map(editor.ids.map((id, index) => [id, index]))
  return editor.ids.length ? `<ol class="manage-stages">${editor.ids.map((id, index) => {
    const stage = editor.available.find(stage => stage.id === id)
    const attrs = `data-id="${esc(id)}"`
    const deps = (editor.requires?.[id] ?? []).filter(dep => position.has(dep) && position.get(dep) < index)
    const depNote = deps.length
      ? `<small class="dep-note">${icon('lock', 13)} 需先学会：${esc(deps.map(dep => titles.get(dep) ?? dep).join('、'))}</small>` : ''
    return `<li><span class="step-number">${index + 1}</span><div class="step-text"><strong>${esc(stage?.title ?? id)}</strong>
      <small>${stage?.visibility === 'public' ? '公开' : '私有'}${stage?.owned ? ' · 我的关卡' : stage?.author ? ` · ${esc(stage.author)}` : ''}${stage?.alias ? ' · /' + esc(stage.alias) : ''}</small>${depNote}</div>
      <div class="stage-row-actions">${index > 0 ? button('pick-deps', '', 'icon-btn', 'lock', `${attrs} aria-label="设置前置关卡" title="前置关卡"`) : ''}
      ${editor.course ? button('edit-course-lesson', '', 'icon-btn', 'pen',
        `${attrs} aria-label="编辑课程讲义" title="编辑课程讲义"`)
        : stage?.owned ? button('edit-stage', '', 'icon-btn', 'pen', `${attrs} aria-label="编辑关卡" title="编辑关卡"`) : ''}
      ${button('move-up', '', 'icon-btn', 'up', `${attrs} aria-label="上移" ${index === 0 ? 'disabled' : ''}`)}
      ${button('move-down', '', 'icon-btn', 'down', `${attrs} aria-label="下移" ${index === editor.ids.length - 1 ? 'disabled' : ''}`)}
      ${button('remove-stage', '', 'icon-btn', 'close', `${attrs} aria-label="移除关卡" title="移除关卡"`)}</div></li>`
  }).join('')}</ol>` : note('在课程中创建关卡，或引用自己创建过的关卡。')
}

export function prerequisiteEditor(editor) {
  const selected = editor.prerequisites
  const available = editor.prerequisiteChoices.filter(item => !selected.some(entry => entry.courseId === item.id))
  return `<ul class="prerequisite-list">${selected.map(item => `<li>
    <div class="step-text"><strong>${esc(item.title ?? '前置课程暂不可访问')}</strong>${item.visibility === 'private' ? '<small>私有</small>' : ''}</div>
    <select data-prerequisite-mode data-id="${esc(item.courseId)}" aria-label="${esc(item.title ?? '前置课程')}的学习要求">
      ${options([['required', '必修'], ['recommended', '建议']], item.mode)}
    </select>
    ${button('remove-prerequisite', '', 'icon-btn', 'close', `data-id="${esc(item.courseId)}" aria-label="移除${esc(item.title ?? '前置课程')}"`)}
  </li>`).join('')}</ul>
  ${available.length ? `<div class="inline-actions prerequisite-picker">
    <select data-prerequisite-choice aria-label="选择前置课程">${available.map(item =>
      `<option value="${esc(item.id)}">${esc(item.title)}${item.visibility === 'private' ? '（私有）' : ''}</option>`).join('')}</select>
    ${button('add-prerequisite', '添加前置课程', 'btn', 'plus', selected.length >= 12 ? 'disabled' : '')}
  </div>` : '<p class="subtle">没有更多可添加的课程。</p>'}`
}

export function courseEditor(editor) {
  const item = editor.course ?? {}
  return `<p class="breadcrumb">${link(item.id ? coursePath(item) : '/owned', item.id ? '返回课程' : '我的创作', 'back', 'left')}</p>
    <div class="page-heading"><h1>${item.id ? '编辑课程' : '创建课程'}</h1>
      ${item.id ? `<div class="editor-toolbar">
        <span data-course-save-status role="status">已保存</span>
        ${item.owned ? button('course-sharing', '共享设置', 'btn', 'users') : ''}
        ${button('course-history', '历史版本', 'btn', 'layers')}
        ${button('reload-course', '放弃草稿并加载最新版', 'btn', null, 'data-course-reload hidden')}
      </div>` : '<p>编排关卡，搭建一条可以反复练习的学习路径。</p>'}
    </div>
    <form class="editor form-panel" data-form="course">
      <h2>课程信息</h2>
      <label>课程名称<input name="title" maxlength="100" required value="${esc(item.title)}" placeholder="例如，AI 视频创作工作流"></label>
      ${!item.id || item.owned ? `<label><span class="field-label">课程别名 <span class="subtle">选填</span></span>
        <input name="alias" aria-label="课程别名" aria-describedby="course-alias-help course-alias-status" maxlength="60" minlength="2" pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*"
          value="${esc(item.alias)}" placeholder="例如 pan-baidu" autocapitalize="none" spellcheck="false">
        <small id="course-alias-help" class="subtle">2–60 个英文字母、数字或短横线，不能重复。保存后优先使用 /course/别名。</small>
        <span id="course-alias-status" class="alias-status" data-course-alias-status role="status" aria-live="polite"></span></label>` : ''}
      <label>课程介绍<textarea name="description" maxlength="1200" rows="3" placeholder="学完这门课程，可以完成什么？">${esc(item.description)}</textarea></label>
      <div class="form-columns">
        <label>课程分类<select name="category">${options(categories.map(name => [name, name]), item.category ?? 'AI 创作')}</select></label>
        <label>主题色<select name="theme">${options(Object.entries(themes), item.theme ?? 'violet')}</select></label>
        ${!item.id || item.owned ? `<label>可见性<select name="visibility">${visOptions(item.visibility)}</select></label>` : ''}
      </div>
      ${!item.id || item.owned ? `<div class="label-picker" role="group" aria-label="课程标签">
        <span class="subtle">标签</span>
        ${[['draft', '编写中'], ['done', '完结']].map(([value, name]) => `<label class="label-choice">
          <input type="radio" name="progress-label" value="${value}" ${(item.labels ?? []).includes(value) ? 'checked' : ''}> ${name}</label>`).join('')}
        <label class="label-choice"><input type="radio" name="progress-label" value="" ${['draft', 'done'].some(value => (item.labels ?? []).includes(value)) ? '' : 'checked'}> 不标注进度</label>
        <label class="label-choice"><input type="checkbox" name="co-create" ${(item.labels ?? []).includes('co-create') ? 'checked' : ''}> 期待共创</label>
        ${editor.isAdmin ? `<label class="label-choice"><input type="checkbox" name="featured" ${(item.labels ?? []).includes('featured') ? 'checked' : ''}> 精品（管理员）</label>` : ''}
      </div>` : ''}
      ${!item.id || item.owned ? `<div class="editor-divider"></div><h2>前置课程</h2>
        <p class="subtle">必修课程完成后解锁本课。建议课程可以跳过。公开课程使用公开的前置课程。</p>
        <div data-prerequisite-editor>${prerequisiteEditor(editor)}</div>` : ''}
      <div class="editor-divider"></div>
      <div class="section-head editor-heading"><h2>课程关卡</h2><div class="inline-actions">
        ${!item.id || item.owned ? button('pick-stage', '引用已有', 'btn', 'link') : ''}${button('new-stage', '新建关卡', 'btn', 'plus')}
      </div></div>
      <div data-picked-stages>${pickedStages(editor)}</div>
      <p class="subtle">同一个关卡可以出现在多门课里。发布课程前，先公开其中所有关卡。</p>
      <div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">${item.id ? '保存一个版本' : '创建课程'}</button></div>
    </form>`
}

export function stageEditor(stage, mode = 'stage') {
  const lesson = mode === 'course-lesson'
  return `<form data-form="${mode}" data-id="${esc(stage?.id)}">
    <label>关卡名称<input name="title" required maxlength="100" value="${esc(stage?.title)}"></label>
    ${mode !== 'stage' ? `<label><span class="field-label">步骤别名 <span class="subtle">选填</span></span>
      <input name="alias" maxlength="60" minlength="2" pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*"
        value="${esc(stage?.alias)}" placeholder="例如 bind" autocapitalize="none" spellcheck="false">
      <small class="subtle">同一课程内不能重复，链接会优先使用别名。</small></label>` : ''}
    <label>学习任务<textarea name="task" required maxlength="5000" rows="2" placeholder="描述一个可以完成的任务">${esc(stage?.task)}</textarea></label>
    <label><span class="field-label">教程 <span class="subtle">支持 Markdown</span></span><textarea name="tutorial" rows="6" maxlength="35000" placeholder="练习步骤、示例和参考链接">${esc(stage?.tutorial)}</textarea></label>
    <div class="placement-tools">
      <p class="subtle" data-placement-status role="status">将光标放在练习题后，插入对应的提交框。</p>
      <input data-submit-prompt maxlength="300" placeholder="这一题要交什么（写清：交什么、几条、什么格式）">
      <div class="inline-actions">${submissionKinds.filter(kind => !lesson || stage.methods.includes(kind))
        .map(kind => button('insert-submission', '插入' + methods[kind][0], 'btn', methods[kind][1], `data-kind="${kind}"`)).join('')}</div>
      <div class="ask-tools">
        <input data-ask-question maxlength="60" placeholder="提问，例如：你准备做哪一类？">
        <input data-ask-options maxlength="200" placeholder="选项（逗号分隔，留空就是文本框）">
        ${button('insert-ask', '插入提问', 'btn', 'text')}
      </div>
    </div>
    ${lesson ? '<p class="subtle">这份讲义在当前课程显示。学习状态和提交按关卡共享。</p>'
      : `<fieldset><legend>提交方式</legend><div class="method-rows">${Object.entries(methods).map(([value, [label]]) => {
        if (value === 'learned') {
          return `<div class="method-row"><label><input type="checkbox" name="methods" value="learned" checked disabled> ${label}</label><span class="subtle">完成关卡时使用</span></div>`
        }
        const on = (stage?.methods ?? ['learned']).includes(value)
        const must = on && (stage?.required ?? []).includes(value)
        return `<div class="method-row"><label><input type="checkbox" name="methods" value="${value}" ${on ? 'checked' : ''}> ${label}</label>
          <label class="required-toggle"><input type="checkbox" name="required" value="${value}" ${must ? 'checked' : ''} ${on ? '' : 'disabled'}> 必填</label></div>`
      }).join('')}</div>
      <p class="subtle">必填项必须先提交，学习者才能标记学会了。</p></fieldset>`}
    ${mode === 'stage' || mode === 'course-draft-stage' ? `<label>可见性<select name="visibility">${visOptions(stage?.visibility)}</select></label>` : ''}
    ${lesson ? `<span data-lesson-save-status role="status">已保存</span>
      ${button('reload-course', '放弃草稿并加载最新版', 'btn', null, 'data-lesson-reload hidden')}` : ''}
    <div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">${lesson ? '完成' : stage?.id ? '保存关卡' : '创建关卡'}</button></div>
  </form>`
}
