import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { tutorialTokens } from './tutorial.js'

// This module is loaded only when an author opens a text editor.
export function mountMarkdownEditor(container, { markdown, references = '', onChange, onInsert, onClose }) {
  container.innerHTML = `<div class="rich-editor">
    <div class="rich-toolbar" role="toolbar" aria-label="正文格式">
      <select data-rich-format aria-label="文字格式"><option value="paragraph">正文</option><option value="1">一级标题</option><option value="2">二级标题</option><option value="3">三级标题</option></select>
      <button type="button" data-rich-command="bold" aria-label="加粗" title="加粗（Ctrl+B）"><b>B</b></button>
      <button type="button" data-rich-command="italic" aria-label="斜体" title="斜体（Ctrl+I）"><i>I</i></button>
      <button type="button" data-rich-command="bulletList" aria-label="无序列表" title="无序列表">• 列表</button>
      <button type="button" data-rich-command="orderedList" aria-label="有序列表" title="有序列表">1. 列表</button>
      <button type="button" data-rich-command="blockquote" aria-label="引用" title="引用">引用</button>
      <button type="button" data-rich-command="codeBlock" aria-label="代码块" title="代码块">代码</button>
      <button type="button" data-rich-command="link" aria-label="插入链接">链接</button>
      <button type="button" data-rich-command="image" aria-label="插入图片">图片</button>
      <button type="button" data-rich-command="table" aria-label="插入表格">表格</button>
      <button type="button" data-rich-command="undo" aria-label="撤销编辑" title="撤销（Ctrl+Z）">↶</button>
      <button type="button" data-rich-command="redo" aria-label="重做编辑" title="重做（Ctrl+Shift+Z）">↷</button>
    </div>
    <div class="rich-url-panel" hidden>
      <label><span data-rich-url-label>链接地址</span><input data-rich-url placeholder="https://…" inputmode="url" autocomplete="off"></label>
      <label>显示文字或图片说明<input data-rich-caption maxlength="300"></label>
      <div class="inline-actions"><button type="button" class="btn" data-rich-command="apply-url">插入</button><button type="button" class="text-btn" data-rich-command="cancel-url">取消</button></div>
      <p class="form-error" role="alert" hidden>请填写有效的网页地址或站内路径。</p>
    </div>
    <div class="rich-table-tools" hidden>
      <button type="button" data-rich-command="addRowAfter">添加行</button><button type="button" data-rich-command="addColumnAfter">添加列</button><button type="button" data-rich-command="deleteRow">删除行</button><button type="button" data-rich-command="deleteColumn">删除列</button><button type="button" data-rich-command="deleteTable">删除表格</button>
    </div>
    <div data-rich-content></div>
    <label class="rich-source-label" hidden>Markdown 源码<textarea data-rich-source aria-label="Markdown 源码" rows="12" maxlength="35000" spellcheck="false"></textarea></label>
    <div class="rich-footer">
      <div class="rich-modes" role="group" aria-label="编辑模式"><button type="button" data-rich-command="visual" aria-pressed="true">所见即所得</button><button type="button" data-rich-command="source" aria-pressed="false">Markdown</button></div>
      <button type="button" class="text-btn" data-rich-command="done">收起编辑</button>
    </div>
    <div class="rich-insert" aria-label="在光标处插入"><span class="subtle">在光标处插入</span>${[['question', '提问'], ['answer', '答案框'], ['screenshot', '截图上传'], ['file', '文件上传']].map(([type, label]) => `<button type="button" data-rich-insert="${type}">＋ ${label}</button>`).join('')}</div>
  </div>`
  const source = container.querySelector('[data-rich-source]')
  const content = container.querySelector('[data-rich-content]')
  const sourceLabel = container.querySelector('.rich-source-label')
  const toolbar = container.querySelector('.rich-toolbar')
  const tableTools = container.querySelector('.rich-table-tools')
  const urlPanel = container.querySelector('.rich-url-panel')
  let raw = markdown
  let sourceMode = false
  let pendingChange = false
  let urlKind
  let disposed = false
  let ownDefinitions = tutorialTokens(markdown).filter(token => token.type === 'def').map(token => token.raw).join('\n')
  let editor
  editor = new Editor({
    element: content,
    injectCSS: false,
    extensions: [
      StarterKit.configure({ underline: false, trailingNode: false, link: { openOnClick: false, autolink: false, linkOnPaste: false } }),
      Markdown.configure({ markedOptions: { gfm: true }, indentation: { style: 'space', size: 2 } }),
      Image.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: false } }),
      TaskList, TaskItem.configure({ nested: true }),
    ],
    content: visualSource(markdown),
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'markdown rich-document', role: 'textbox', 'aria-label': '教程正文', 'aria-multiline': 'true' },
      handlePaste(view, event) {
        if (editor.isActive('codeBlock') || editor.isActive('code')) return false
        const text = event.clipboardData?.getData('text/plain')
        if (!text || event.clipboardData.getData('text/html') || !/(^|\n)(#{1,6} |[-*>] |\d+\. |```|\|)|\*\*[^*]+\*\*/.test(text)) return false
        event.preventDefault()
        editor.commands.insertContent(text, { contentType: 'markdown' })
        return true
      },
    },
    onUpdate({ editor: current }) {
      if (sourceMode || disposed) return
      pendingChange = true
      raw = current.getMarkdown() + (ownDefinitions ? '\n\n' + ownDefinitions : '')
      if (!current.view.composing) flush()
    },
    onTransaction: () => updateToolbar(),
  })

  function flush() {
    if (!disposed && pendingChange) {
      onChange(raw)
      pendingChange = false
    }
  }

  function visualSource(value) {
    return [value.trimEnd(), references.trim()].filter(Boolean).join('\n\n')
  }

  function updateToolbar() {
    if (!editor || disposed) return
    const format = container.querySelector('[data-rich-format]')
    const level = editor.getAttributes('heading').level
    format.value = level && level <= 3 ? String(level) : 'paragraph'
    for (const button of toolbar.querySelectorAll('[data-rich-command]')) {
      const command = button.dataset.richCommand
      if (['bold', 'italic', 'bulletList', 'orderedList', 'blockquote', 'codeBlock'].includes(command)) {
        button.setAttribute('aria-pressed', String(editor.isActive(command)))
      }
      if (command === 'undo' || command === 'redo') button.disabled = !editor.can()[command]()
    }
    tableTools.hidden = sourceMode || !editor.isActive('table')
  }

  function setMode(mode) {
    if (mode === sourceMode) return
    if (mode) source.value = raw
    else {
      raw = source.value
      ownDefinitions = tutorialTokens(raw).filter(token => token.type === 'def').map(token => token.raw).join('\n')
      editor.commands.setContent(visualSource(raw), { contentType: 'markdown', emitUpdate: false })
    }
    sourceMode = mode
    content.hidden = mode
    sourceLabel.hidden = !mode
    toolbar.hidden = mode
    urlPanel.hidden = true
    tableTools.hidden = mode || !editor.isActive('table')
    container.querySelector('[data-rich-command="source"]').setAttribute('aria-pressed', String(mode))
    container.querySelector('[data-rich-command="visual"]').setAttribute('aria-pressed', String(!mode))
    if (mode) source.focus()
    else editor.commands.focus()
  }

  function split() {
    if (sourceMode) {
      let end = 0
      for (const token of tutorialTokens(raw)) {
        end += token.raw.length
        if (end >= source.selectionEnd) break
      }
      return [raw.slice(0, end), raw.slice(end)]
    }
    let position = editor.state.selection.to
    const resolved = editor.state.doc.resolve(position)
    for (let depth = resolved.depth; depth > 0; depth--) {
      if (resolved.node(depth).type.name === 'table') { position = resolved.after(depth); break }
    }
    const before = editor.markdown.serialize(editor.state.doc.cut(0, position).toJSON())
    let after = editor.markdown.serialize(editor.state.doc.cut(position).toJSON())
    if (ownDefinitions) after += '\n\n' + ownDefinitions
    return [before, after]
  }

  function click(event) {
    const insert = event.target.closest('[data-rich-insert]')
    if (insert) { flush(); onInsert(insert.dataset.richInsert, split()); return }
    const button = event.target.closest('[data-rich-command]')
    if (!button) return
    const command = button.dataset.richCommand
    if (command === 'source' || command === 'visual') { setMode(command === 'source'); return }
    if (command === 'done') { flush(); onClose(); return }
    if (command === 'cancel-url') { urlPanel.hidden = true; editor.commands.focus(); return }
    if (command === 'link' || command === 'image') {
      urlKind = command
      urlPanel.hidden = false
      urlPanel.querySelector('.form-error').hidden = true
      container.querySelector('[data-rich-url-label]').textContent = command === 'image' ? '图片地址' : '链接地址'
      container.querySelector('[data-rich-url]').value = command === 'link' ? editor.getAttributes('link').href ?? '' : ''
      container.querySelector('[data-rich-caption]').value = ''
      container.querySelector('[data-rich-url]').focus()
      return
    }
    if (command === 'apply-url') {
      const url = container.querySelector('[data-rich-url]').value.trim()
      const caption = container.querySelector('[data-rich-caption]').value.trim()
      if (!/^(https?:\/\/|\/(?!\/)|#|mailto:)/i.test(url) || (urlKind === 'image' && /^(#|mailto:)/i.test(url))) {
        urlPanel.querySelector('.form-error').hidden = false
        return
      }
      if (urlKind === 'image') editor.chain().focus().setImage({ src: url, alt: caption }).run()
      else if (editor.state.selection.empty) editor.chain().focus().insertContent({ type: 'text', text: caption || url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
      else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      urlPanel.hidden = true
      return
    }
    const chain = editor.chain().focus()
    const toggles = { bold: 'toggleBold', italic: 'toggleItalic', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote', codeBlock: 'toggleCodeBlock' }
    if (toggles[command]) chain[toggles[command]]().run()
    else if (command === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    else if (['undo', 'redo', 'addRowAfter', 'addColumnAfter', 'deleteRow', 'deleteColumn', 'deleteTable'].includes(command)) chain[command]().run()
  }
  function pointerdown(event) {
    if (event.target.closest('button')) event.preventDefault()
  }
  function change(event) {
    if (!event.target.matches('[data-rich-format]')) return
    const value = event.target.value
    if (value === 'paragraph') editor.chain().focus().setParagraph().run()
    else editor.chain().focus().setHeading({ level: Number(value) }).run()
  }
  function input(event) {
    if (event.target !== source) return
    raw = source.value
    pendingChange = true
    if (!event.isComposing) flush()
  }
  function compositionEnd() {
    flush()
  }
  container.addEventListener('click', click)
  container.addEventListener('pointerdown', pointerdown)
  container.addEventListener('change', change)
  container.addEventListener('input', input)
  container.addEventListener('compositionend', compositionEnd)
  updateToolbar()
  // Raw HTML has a broader vocabulary than the visual editor's schema.
  if (tutorialTokens(markdown).some(token => token.type === 'html')) setMode(true)
  else editor.commands.focus()
  return {
    flush,
    focus: () => sourceMode ? source.focus() : editor.commands.focus('end'),
    destroy() {
      disposed = true
      container.removeEventListener('click', click)
      container.removeEventListener('pointerdown', pointerdown)
      container.removeEventListener('change', change)
      container.removeEventListener('input', input)
      container.removeEventListener('compositionend', compositionEnd)
      editor.destroy()
    },
  }
}
