import DOMPurify from 'dompurify'
import { icon } from './icons.js'
import { layoutTutorial, submissionKinds } from './tutorial.js'

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export const key = encodeURIComponent
export const categories = ['AI 创作', '编程开发', '效率工具', '产品设计', '其他']
export const themes = { violet: '紫色', peach: '暖橙', blue: '蓝色', mint: '绿色' }
export const methods = {
  learned: ['学会了', 'check'],
  answer: ['文本答案', 'text'],
  screenshot: ['截图上传', 'image'],
  file: ['文件上传', 'file'],
}
export const coursePath = id => '/course/' + key(id)
export const stagePath = (id, course) => course ? coursePath(course.id) + '/stage/' + key(id) : '/stage/' + key(id)
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

export function visibility(value) {
  return `<span class="visibility">${icon(value === 'public' ? 'globe' : 'lock', 14)}${value === 'public' ? '公开' : '私有'}</span>`
}

export function progress(course) {
  return `<div class="progress"><div><span>学习进度</span><strong>${course.completedCount} / ${course.stageCount}</strong></div>
    <progress value="${course.completedCount}" max="${course.stageCount || 1}" aria-label="学习进度"></progress></div>`
}

export function card(course, scope) {
  return `<a class="course-card" href="${coursePath(course.id)}" data-link>
    <div class="card-cover theme-${theme(course)}"><span class="cover-icon">${icon(topicIcon(course), 28)}</span><span class="cover-orbit"></span></div>
    <div class="card-content">
      <div class="card-tag">${esc(course.category)}${scope === 'owned' ? visibility(course.visibility) : ''}${scope === 'owned' && !course.owned ? '<span class="visibility">协作课程</span>' : ''}${course.moderated_at ? '<span class="visibility">已下架</span>' : ''}</div>
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
      <a class="btn primary" href="${coursePath(course.id)}" data-link>开始学习 ${icon('arrow', 17)}</a>
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
        <div class="card-tag">${esc(course.category)}${visibility(course.visibility)}${course.moderated_at ? '<span class="visibility">已下架</span>' : ''}</div>
        <h1>${esc(course.title)}</h1><p>${esc(course.description)}</p>
        <div class="intro-meta"><span>${icon('user', 16)}${esc(course.author)}</span><span>${icon('layers', 16)}${course.stageCount} 个关卡</span><span>${icon('users', 16)}${course.learnerCount} 人学习</span></div>
      </div>
      <div class="intro-actions">
        ${next ? link(stagePath(next.id, course), course.completedCount ? '继续学习' : '开始学习', 'btn primary', 'play') : ''}
        ${!course.learningLocked && !course.joined && !course.owned ? button('join', '加入我的学习', 'btn', 'plus') : ''}
        ${course.canEdit ? link(coursePath(course.id) + '/edit', '编辑课程', 'btn', 'pen') : ''}
      </div>
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
      ${item.title ? link(coursePath(item.courseId), item.completed ? '查看课程' : '去学习', 'btn', 'arrow') : ''}
    </li>`).join('')}</ul>
  </section>`
}

export function outline(course, active) {
  return course.stages.length ? `<ol class="outline">${course.stages.map((stage, i) => {
    const contents = `
      <span class="step-number ${stage.learned ? 'done' : ''}">${stage.learned ? icon('check', 16) : i + 1}</span>
      <span class="step-text"><strong>${esc(stage.title)}</strong>${active || course.learningLocked ? '' : `<small>${esc(stage.task)}</small>`}</span>
      ${icon(course.learningLocked ? 'lock' : 'chevron', 16)}`
    return `<li>${course.learningLocked ? `<div class="locked-step">${contents}</div>`
      : `<a href="${stagePath(stage.id, course)}" data-link ${active === stage.id ? 'aria-current="page"' : ''}>${contents}</a>`}</li>`
  }).join('')}</ol>` : note('这门课还没有关卡。')
}

export function stageStats(stage) {
  return `<span class="stat-main">${icon('users', 17)} <strong>${stage.stats.participants}</strong> 人参与</span>
    ${Object.entries(methods).filter(([kind]) => stage.methods.includes(kind) || stage.stats[kind]).map(([kind, [label]]) =>
      `<span>${esc(label)} <strong>${stage.stats[kind]}</strong></span>`).join('')}`
}

export function submission(stage, kind) {
  if (kind === 'learned') {
    return button('learned', stage.learned ? '已学会 · 撤销' : '标记学会了', stage.learned ? 'btn done' : 'btn', 'check')
  }
  const current = stage.submissions.find(entry => entry.kind === kind)
  const allowed = stage.methods.includes(kind)
  if (!current && !allowed) return ''
  const [label, symbol] = methods[kind]
  const uploaded = `/api/stages/${key(stage.id)}/upload/${kind}`
  const title = `<div class="submit-title">${icon(symbol, 19)}<h3>${label}</h3>${current ? '<span class="saved">已提交</span>' : ''}</div>`
  if (kind === 'answer') {
    return `<form class="submission" data-form="answer">${title}
      <textarea name="answer" aria-label="文本答案" maxlength="20000" rows="4" placeholder="写下你的练习答案或学习记录…" required ${allowed ? '' : 'readonly'}>${esc(current?.answer)}</textarea>
      ${allowed ? `<div class="submit-row"><button class="btn primary">${current ? '保存修改' : '提交答案'}</button></div>` : ''}
    </form>`
  }
  return `<form class="submission" data-form="upload" data-kind="${kind}">${title}
    ${current ? `<div class="existing-file">${kind === 'screenshot' ? `<a href="${uploaded}"><img src="${uploaded}?preview=1&amp;v=${key(current.updated_at)}" alt="已提交截图"></a>` : icon('file', 18)}
      <a href="${uploaded}">${esc(current.filename)}</a></div>` : ''}
    ${allowed ? `<div class="upload-row"><label class="file-picker">${icon('upload', 18)}<span>选择${kind === 'screenshot' ? '截图' : '文件'}</span>
      <input type="file" name="upload" ${kind === 'screenshot' ? 'accept="image/png,image/jpeg,image/webp,image/gif"' : ''} required></label>
      <span class="file-label subtle">最多 10 MB</span><button class="btn">${current ? '替换上传' : '提交上传'}</button></div>` : ''}
  </form>`
}

function submissionSlot(stage, kind) {
  return `<div data-submission="${kind}">${submission(stage, kind)}</div>`
}

function tutorialPanel(stage) {
  const kinds = submissionKinds.filter(kind => stage.methods.includes(kind) || stage.submissions.some(entry => entry.kind === kind))
  if (!stage.tutorial) {
    return kinds.length ? `<section class="lesson-panel"><h2>${icon('upload', 20)} 练习提交</h2>
      ${kinds.map(kind => submissionSlot(stage, kind)).join('')}</section>` : ''
  }

  const { blocks, remaining } = layoutTutorial(stage.tutorial, kinds)
  const content = blocks.map(block => block.kind ? submissionSlot(stage, block.kind) : `<div class="markdown">${DOMPurify.sanitize(block.html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'style', 'iframe'],
    FORBID_ATTR: ['style', 'id', 'class'],
    ALLOW_DATA_ATTR: false,
  })}</div>`).join('')
  return `<section class="lesson-panel lesson-tutorial"><h2>${icon('book', 20)} 教程</h2>
    ${kinds.length ? '<p class="subtle submission-intro">做到对应步骤即可提交，也可以之后回来修改。</p>' : ''}
    ${content}
    ${remaining.length ? `<h3 class="remaining-heading">其他提交</h3>${remaining.map(kind => submissionSlot(stage, kind)).join('')}` : ''}
  </section>`
}

export function stagePage(stage, course) {
  return `<p class="breadcrumb">${course ? link(coursePath(course.id), esc(course.title), 'back', 'left') : link('/stages', '关卡库', 'back', 'left')}</p>
    <div class="learning-layout ${course ? '' : 'standalone'}">
      <article class="lesson">
        <header class="lesson-header">
          <div class="lesson-kicker">${icon('layers', 17)} ${course ? `关卡 ${course.stages.findIndex(item => item.id === stage.id) + 1} / ${course.stageCount}` : '独立关卡'}</div>
          <div class="section-head"><h1>${esc(stage.title)}</h1>${stage.owned ? button('edit-stage', course ? '编辑原关卡' : '编辑', 'btn', 'pen',
            `data-id="${esc(stage.id)}"`) : ''}</div>
          <div class="lesson-status"><div class="stats" data-stage-stats>${stageStats(stage)}</div>${submissionSlot(stage, 'learned')}</div>
        </header>
        <section class="task-box"><h2>${icon('target', 20)} 学习任务</h2><p>${esc(stage.task)}</p></section>
        ${tutorialPanel(stage)}
      </article>
      ${course ? `<aside class="lesson-outline"><h2>本课关卡</h2><div data-outline>${progress(course)}${outline(course, stage.id)}</div></aside>` : ''}
    </div>`
}

const options = (choices, selected) => choices.map(([value, name]) =>
  `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(name)}</option>`).join('')
const visOptions = value => options([['private', '私有'], ['public', '公开']], value)

export function pickedStages(editor) {
  return editor.ids.length ? `<ol class="manage-stages">${editor.ids.map((id, index) => {
    const stage = editor.available.find(stage => stage.id === id)
    const attrs = `data-id="${esc(id)}"`
    return `<li><span class="step-number">${index + 1}</span><div class="step-text"><strong>${esc(stage?.title ?? id)}</strong>
      <small>${stage?.visibility === 'public' ? '公开' : '私有'}${stage?.owned ? ' · 我的关卡' : stage?.author ? ` · ${esc(stage.author)}` : ''}</small></div>
      ${editor.course ? button('edit-course-lesson', '', 'icon-btn', 'pen',
        `${attrs} aria-label="编辑课程讲义" title="编辑课程讲义"`)
        : stage?.owned ? button('edit-stage', '', 'icon-btn', 'pen', `${attrs} aria-label="编辑关卡" title="编辑关卡"`) : ''}
      ${button('move-up', '', 'icon-btn', 'up', `${attrs} aria-label="上移" ${index === 0 ? 'disabled' : ''}`)}
      ${button('move-down', '', 'icon-btn', 'down', `${attrs} aria-label="下移" ${index === editor.ids.length - 1 ? 'disabled' : ''}`)}
      ${button('remove-stage', '', 'icon-btn', 'close', `${attrs} aria-label="移除关卡" title="移除关卡"`)}</li>`
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
  return `<p class="breadcrumb">${link(item.id ? coursePath(item.id) : '/owned', item.id ? '返回课程' : '我的创作', 'back', 'left')}</p>
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
      <label>课程介绍<textarea name="description" maxlength="1200" rows="3" placeholder="学完这门课程，可以完成什么？">${esc(item.description)}</textarea></label>
      <div class="form-columns">
        <label>课程分类<select name="category">${options(categories.map(name => [name, name]), item.category ?? 'AI 创作')}</select></label>
        <label>主题色<select name="theme">${options(Object.entries(themes), item.theme ?? 'violet')}</select></label>
        ${!item.id || item.owned ? `<label>可见性<select name="visibility">${visOptions(item.visibility)}</select></label>` : ''}
      </div>
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
    <label>学习任务<textarea name="task" required maxlength="5000" rows="2" placeholder="描述一个可以完成的任务">${esc(stage?.task)}</textarea></label>
    <label>教程 <span class="subtle">支持 Markdown</span><textarea name="tutorial" rows="6" maxlength="35000" placeholder="练习步骤、示例和参考链接">${esc(stage?.tutorial)}</textarea></label>
    <div class="placement-tools">
      <p class="subtle" data-placement-status role="status">将光标放在练习题后，插入对应的提交框。</p>
      <div class="inline-actions">${submissionKinds.filter(kind => !lesson || stage.methods.includes(kind))
        .map(kind => button('insert-submission', '插入' + methods[kind][0], 'btn', methods[kind][1], `data-kind="${kind}"`)).join('')}</div>
    </div>
    ${lesson ? '<p class="subtle">这份讲义在当前课程显示。学习状态和提交按关卡共享。</p>'
      : `<fieldset><legend>提交方式</legend><div class="checks">${Object.entries(methods).map(([value, [label]]) =>
        `<label><input type="checkbox" name="methods" value="${value}" ${(stage?.methods ?? ['learned']).includes(value) ? 'checked' : ''} ${value === 'learned' ? 'disabled' : ''}> ${label}</label>`).join('')}</div></fieldset>`}
    ${mode === 'stage' || mode === 'course-draft-stage' ? `<label>可见性<select name="visibility">${visOptions(stage?.visibility)}</select></label>` : ''}
    ${lesson ? `<span data-lesson-save-status role="status">已保存</span>
      ${button('reload-course', '放弃草稿并加载最新版', 'btn', null, 'data-lesson-reload hidden')}` : ''}
    <div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">${lesson ? '完成' : stage?.id ? '保存关卡' : '创建关卡'}</button></div>
  </form>`
}
