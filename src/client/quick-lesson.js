import { marked } from 'marked'
import { tutorialTokens, submissionMarker } from './tutorial.js'
import { button, esc, markdownBlock, methods } from './views.js'
import { icon } from './icons.js'

export function lessonBlocks(tutorial) {
  const blocks = []
  for (const token of tutorialTokens(tutorial)) {
    if (token.type === 'space' && blocks.length) {
      blocks.at(-1).raw += token.raw
      continue
    }
    blocks.push({
      id: crypto.randomUUID(), raw: token.raw,
      type: token.field ? 'question' : token.submission ? token.submission.kind : 'text',
      fieldKey: token.field?.key ?? token.field?.name,
      name: token.field?.name, options: token.field?.options ?? [],
      prompt: token.submission?.prompt,
    })
  }
  return blocks
}

export function lessonPayload(editor) {
  return {
    title: editor.title, task: editor.task, tutorial: editor.blocks.map(block => block.raw).join(''),
    methods: ['learned', ...['answer', 'screenshot', 'file'].filter(kind => editor.enabled.includes(kind))],
    required: ['answer', 'screenshot', 'file'].filter(kind => editor.enabled.includes(kind) && editor.required.includes(kind)),
    requiredFields: editor.requiredFields.filter(key => editor.blocks.some(block => block.fieldKey === key)),
  }
}

export function updateBlock(block, control) {
  const property = control.dataset.quickProperty
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
      ${[['text', '文字'], ['question', '提问'], ['answer', '答案框'], ['screenshot', '截图'], ['file', '文件']].map(([type, name]) =>
        button('quick-add', name, 'btn', null, `data-after="${block.id}" data-type="${type}"`)).join('')}
    </div></div>`
  if (block.type === 'text') {
    const definitions = editor.blocks.filter(item => /^\s*\[[^\]]+\]:/.test(item.raw)).map(item => item.raw).join('\n')
    return `<section class="quick-block quick-text" data-quick-block="${block.id}">
      ${controls}<button type="button" class="quick-text-preview" data-action="quick-text" ${attributes} aria-label="编辑这段文字">
        ${markdownBlock(marked.parse(block.raw + '\n' + definitions))}<span class="quick-edit-hint">${icon('pen', 14)} 点击编辑</span>
      </button>
      <label class="quick-text-input" hidden>编辑内容 <span class="subtle">支持 Markdown</span>
        <textarea data-quick-property="text" aria-label="编辑这段文字" rows="4" maxlength="35000">${esc(block.raw.trimEnd())}</textarea>
      </label>${insert}</section>`
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
    ${question ? `<label>选项 <span class="subtle">用逗号分隔，留空显示输入框</span>
      <input data-quick-property="options" value="${esc(block.options.join('，'))}" aria-label="选项" maxlength="700"></label>` : ''}
    <div class="quick-field-toggles">
      ${question ? '' : `<label><input type="checkbox" data-quick-property="enabled" ${enabled ? 'checked' : ''}> 启用</label>`}
      <label><input type="checkbox" data-quick-property="required" ${required ? 'checked' : ''} ${enabled ? '' : 'disabled'}> 必填</label>
      <span class="subtle">必填项完成后才可标记学会</span>
    </div>
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
    <label>关卡名称<input data-quick-title value="${esc(editor.title)}" maxlength="100"></label>
    <label>学习任务<textarea data-quick-task maxlength="5000" rows="2">${esc(editor.task)}</textarea></label>
    <p class="subtle">点击段落编辑文字。调整下方提问和提交框后会自动保存到当前课程。</p>
  </header>
  <div class="quick-blocks" data-quick-blocks>${editor.blocks.map((block, index) => quickBlock(block, editor, index)).join('')}</div>
  <div class="quick-add lesson-panel">
    <label>添加内容<select data-quick-type>
      <option value="text">文字段落</option><option value="question">步骤提问</option>
      ${['answer', 'screenshot', 'file'].map(kind => `<option value="${kind}">${methods[kind][0]}</option>`).join('')}
    </select></label>
    ${button('quick-add', '插入内容', 'btn', 'plus')}
  </div>`
}
