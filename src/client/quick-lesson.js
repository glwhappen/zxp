import { marked } from 'marked'
import { tutorialTokens, submissionMarker, widgetMarker } from './tutorial.js'
import { button, esc, lessonWidget, markdownBlock, methods, renderLessonMarkdown } from './views.js'
import { icon } from './icons.js'

export function lessonBlocks(tutorial) {
  const blocks = []
  for (const token of tutorialTokens(tutorial)) {
    if (blocks.length && (token.type === 'space'
      || (!token.field && !token.submission && !token.widget && blocks.at(-1).type === 'text'))) {
      blocks.at(-1).raw += token.raw
      continue
    }
    blocks.push({
      id: crypto.randomUUID(), raw: token.raw,
      type: token.widget?.type ?? (token.field ? 'question' : token.submission ? token.submission.kind : 'text'),
      title: token.widget?.title, content: token.widget?.content,
      fieldKey: token.field?.key ?? token.field?.name,
      name: token.field?.name, options: token.field?.options ?? [],
      prompt: token.submission?.prompt,
    })
  }
  return blocks
}

export function mergeTextBlocks(blocks) {
  const result = []
  for (const block of blocks) {
    const previous = result.at(-1)
    if (block.type === 'text' && previous?.type === 'text') {
      previous.raw = previous.raw.replace(/\s+$/, '') + '\n\n' + block.raw.replace(/^[\r\n]+/, '')
    } else result.push(block)
  }
  return result
}

export function lessonReferences(editor) {
  return tutorialTokens(editor.blocks.map(block => block.raw).join(''))
    .filter(token => token.type === 'def').map(token => token.raw).join('\n')
}

export function quickFieldPreview(block, editor) {
  const question = block.type === 'question'
  const required = question ? editor.requiredFields.includes(block.fieldKey) : editor.required.includes(block.type)
  const enabled = question || editor.enabled.includes(block.type)
  return `<div class="quick-field-preview" data-quick-field-preview>
    <small class="subtle">学习者预览${enabled ? '' : ' · 已停用'}</small>
    <div class="quick-preview-content">
      <div class="submit-title">${icon(question ? 'text' : methods[block.type][1], 18)}<strong>${esc(question ? block.name : methods[block.type][0])}</strong>${required ? '<span class="saved required">必填</span>' : ''}</div>
      ${question ? block.options.length
        ? `<select aria-label="提问预览" disabled><option>请选择</option>${block.options.map(option => `<option>${esc(option)}</option>`).join('')}<option>其他…</option></select>`
        : '<input aria-label="提问预览" placeholder="简短写一下" disabled>'
        : `<p class="submit-prompt">${esc(block.prompt)}</p>${block.type === 'answer'
          ? '<textarea aria-label="答案框预览" rows="3" placeholder="写下你的练习答案或学习记录…" disabled></textarea>'
          : `<div class="upload-row"><span class="preview-picker">${icon('upload', 16)}${block.type === 'screenshot' ? '选择截图' : '选择文件'}</span><span class="subtle">最多 10 MB</span><button type="button" class="btn upload-submit" disabled>提交上传</button></div>`}`}
    </div></div>`
}

export function lessonPayload(editor) {
  return {
    title: editor.title, alias: editor.alias.trim().toLowerCase(),
    task: editor.task, tutorial: editor.blocks.map(block => block.raw).join(''),
    methods: ['learned', ...['answer', 'screenshot', 'file'].filter(kind => editor.enabled.includes(kind))],
    required: ['answer', 'screenshot', 'file'].filter(kind => editor.enabled.includes(kind) && editor.required.includes(kind)),
    requiredFields: editor.requiredFields.filter(key => editor.blocks.some(block => block.fieldKey === key)),
  }
}

export function updateBlock(block, control) {
  const property = control.dataset.quickProperty
  if (['prompt', 'details'].includes(block.type)) {
    block[property] = control.value
    block.raw = widgetMarker(block.type, block.title, block.content) + '\n\n'
    return
  }
  if (property === 'text') block.raw = control.value.replace(/\s+$/, '') + '\n\n'
  else {
    block[property] = property === 'options' ? control.value.split(/[,，]/).map(item => item.trim()).filter(Boolean) : control.value
    if (block.type === 'question') {
      block.raw = '{{ask:' + block.name + '|' + block.options.join(',') + '|key=' + block.fieldKey + '}}\n\n'
    } else block.raw = submissionMarker(block.type, block.prompt) + '\n\n'
  }
}

export function quickBlock(block, editor, index) {
  const attributes = `data-id="${block.id}"`
  const controls = `<div class="quick-block-actions">
    ${button('quick-up', '', 'icon-btn', 'up', `${attributes} aria-label="上移" ${index === 0 ? 'disabled' : ''}`)}
    ${button('quick-down', '', 'icon-btn', 'down', `${attributes} aria-label="下移" ${index === editor.blocks.length - 1 ? 'disabled' : ''}`)}
    ${button('quick-remove', '', 'icon-btn', 'close', `${attributes} aria-label="移除此内容"`)}
  </div>`
  const insert = `<div class="quick-insert">
    ${button('quick-insert-menu', '在下方插入', 'quick-insert-trigger', 'plus', attributes)}
    <div class="quick-insert-menu" hidden>
      ${[['text', '文字'], ['prompt', '提示词'], ['details', '折叠说明'], ['question', '提问'], ['answer', '答案框'], ['screenshot', '截图'], ['file', '文件']].map(([type, name]) =>
        button('quick-add', name, 'btn', null, `data-after="${block.id}" data-type="${type}"`)).join('')}
    </div></div>`
  if (block.type === 'text') {
    const definitions = lessonReferences(editor)
    const html = marked.parse(block.raw + '\n' + definitions)
    if (!html.trim()) return ''
    return `<section class="quick-block quick-text" data-quick-block="${block.id}">
      <div class="section-head quick-text-head"><h3>${icon('book', 18)} 教程正文</h3>${controls}</div>
      <div role="button" tabindex="0" class="quick-text-preview" data-action="quick-text" ${attributes} aria-label="编辑这段文字">
        ${markdownBlock(html)}
      </div>
      <div class="quick-text-input" data-rich-mount hidden></div>${insert}</section>`
  }
  if (['prompt', 'details'].includes(block.type)) {
    const prompt = block.type === 'prompt'
    return `<section class="quick-block quick-widget" data-quick-block="${block.id}">
      <div class="section-head"><h3>${icon(prompt ? 'spark' : 'chevron', 18)} ${prompt ? '提示词' : '折叠说明'}</h3>${controls}</div>
      <label>${prompt ? '提示词标题' : '折叠标题'}<input data-quick-property="title" aria-label="${prompt ? '提示词标题' : '折叠标题'}" maxlength="100" value="${esc(block.title)}" placeholder="${prompt ? '例如：生成三镜头分镜' : '例如：可选的补充说明'}"></label>
      ${prompt ? `<label>提示词内容<textarea data-quick-property="content" aria-label="提示词内容" rows="7" maxlength="35000" placeholder="在这里填写可以原样复制的提示词">${esc(block.content)}</textarea></label>`
        : `<div class="quick-fold-content"><span class="subtle">折叠内容 · 点击编辑</span><div role="button" tabindex="0" class="quick-text-preview" data-action="quick-text" ${attributes} aria-label="编辑折叠内容">${renderLessonMarkdown(block.content) || '<p class="subtle">点击填写补充说明…</p>'}</div><div class="quick-text-input" data-rich-mount hidden></div></div>`}
      <div class="quick-widget-preview" data-quick-widget-preview><small class="subtle">学习者预览</small>${lessonWidget(block)}</div>
      ${insert}</section>`
  }
  const question = block.type === 'question'
  const required = question ? editor.requiredFields.includes(block.fieldKey) : editor.required.includes(block.type)
  const enabled = question || editor.enabled.includes(block.type)
  return `<section class="quick-block quick-field" data-quick-block="${block.id}">
    <div class="section-head"><h3>${icon(question ? 'text' : methods[block.type][1], 18)} ${question ? '步骤提问' : methods[block.type][0]}</h3>${controls}</div>
    <label>${question ? '问题' : '提交说明'}
      <input data-quick-property="${question ? 'name' : 'prompt'}" value="${esc(question ? block.name : block.prompt)}"
        aria-label="${question ? '问题' : '提交说明'}" maxlength="${question ? 60 : 300}">
    </label>
    ${question ? `<label><span class="field-label">选项 <span class="subtle">用逗号分隔，留空显示输入框</span></span>
      <input data-quick-property="options" value="${esc(block.options.join('，'))}" aria-label="选项" maxlength="700"></label>` : ''}
    <div class="quick-field-toggles">
      ${question ? '' : `<label><input type="checkbox" data-quick-property="enabled" ${enabled ? 'checked' : ''}> 启用</label>`}
      <label><input type="checkbox" data-quick-property="required" ${required ? 'checked' : ''} ${enabled ? '' : 'disabled'}> 必填</label>
      <span class="subtle">必填项完成后才可标记学会</span>
    </div>
    ${quickFieldPreview(block, editor)}
    ${insert}
  </section>`
}

export function quickLesson(editor) {
  return `<div class="quick-toolbar">
    <div><strong>快速编辑</strong><span data-quick-save role="status">已保存</span></div>
    <div class="inline-actions">
      ${button('quick-reload', '放弃草稿并重新加载', 'btn', null, 'data-quick-reload hidden')}
      ${button('quick-checkpoint', '保存版本', 'btn', 'layers')}
      ${button('quick-done', '完成编辑', 'btn primary', 'check')}
    </div>
  </div>
  <header class="lesson-header quick-heading">
    <label>关卡名称<textarea data-quick-title aria-label="关卡名称" rows="1" maxlength="100">${esc(editor.title)}</textarea></label>
    <label><span class="field-label">步骤别名 <span class="subtle">选填</span></span>
      <input data-quick-alias value="${esc(editor.alias)}" maxlength="60" minlength="2"
        pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" placeholder="例如 bind" autocapitalize="none" spellcheck="false">
      <small class="subtle">同一课程内不能重复，2–60 个英文字母、数字或短横线。</small></label>
    <label>学习任务<textarea data-quick-task maxlength="5000" rows="2">${esc(editor.task)}</textarea></label>
    <p class="subtle">连续文字一起编辑，支持所见即所得和 Markdown。可在光标处插入提问或提交框，修改会自动保存。</p>
  </header>
  <div class="quick-blocks" data-quick-blocks>${editor.blocks.map((block, index) => quickBlock(block, editor, index)).join('')}</div>
  <div class="quick-add lesson-panel">
    <label>添加内容<select data-quick-type>
      <option value="text">文字段落</option><option value="question">步骤提问</option>
      <option value="prompt">提示词</option><option value="details">折叠说明</option>
      ${['answer', 'screenshot', 'file'].map(kind => `<option value="${kind}">${methods[kind][0]}</option>`).join('')}
    </select></label>
    ${button('quick-add', '插入内容', 'btn', 'plus')}
  </div>`
}
