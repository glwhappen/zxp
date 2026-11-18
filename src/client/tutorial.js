import { marked } from 'marked'

export const submissionKinds = ['answer', 'screenshot', 'file']
// 提交框必须带说明：{{submit:answer|这一题要交什么}}；不写说明的旧写法只读兼容。
export const submissionMarker = (kind, prompt = '') =>
  prompt ? `{{submit:${kind}|${prompt}}}` : `{{submit:${kind}}}`
export const askMarker = (question, options = []) =>
  `{{ask:${question}${options.length ? '|' + options.join(',') : ''}}}`

function markerSpec(token) {
  if (token.type !== 'paragraph') return
  const match = /^\{\{submit:(answer|screenshot|file)(?:\|([^\n}]+))?\}\}$/.exec(token.raw.trim())
  if (!match) return
  return { kind: match[1], prompt: (match[2] ?? '').trim().slice(0, 300) }
}

export function submissionSpecs(markdown) {
  return marked.lexer(markdown).map(markerSpec).filter(Boolean)
}

// {{ask:问题}} 是文本框；{{ask:问题|选项1,选项2}} 是单选，前端自动补「其他」。
export function askField(token) {
  if (token.type !== 'paragraph') return
  const match = /^\{\{ask:(.+?)\}\}$/.exec(token.raw.trim())
  if (!match) return
  const [rawName, rawOptions = ''] = match[1].split('|')
  const name = rawName.trim()
  if (!name || name.length > 60 || /[\n{}]/.test(name)) return
  const options = rawOptions.split(/[,，]/).map(value => value.trim()).filter(Boolean)
  if (options.length > 12) return
  return { name, options }
}

export function hasSubmissionMarker(markdown, kind) {
  return marked.lexer(markdown).some(token => markerSpec(token)?.kind === kind)
}

export function hasAskMarker(markdown, name) {
  return marked.lexer(markdown).some(token => askField(token)?.name === name)
}

export function layoutTutorial(markdown, kinds) {
  const tokens = marked.lexer(markdown)
  const markers = tokens.map(token => {
    const spec = markerSpec(token)
    if (spec) return spec
    const field = askField(token)
    return field ? { field } : null
  })

  const blocks = []
  const remaining = new Set(kinds)
  let start = 0
  function addSlots(end, slots) {
    const html = marked.parser(tokens.slice(start, end))
    if (html.trim()) blocks.push({ html })
    for (const slot of slots) {
      if (slot.field) {
        blocks.push(slot)
        continue
      }
      const kind = slot.kind ?? slot
      if (remaining.delete(kind)) blocks.push(slot.kind ? slot : { kind })
    }
  }

  // 只有作者手动插入的 {{submit:...}} 才会出现在教程中间；其余提交框一律放到末尾的「交作业」。
  for (let index = 0; index < tokens.length; index++) {
    if (!markers[index]) continue
    addSlots(index, [markers[index]])
    start = index + 1
  }
  addSlots(tokens.length, [])
  return { blocks, remaining: [...remaining] }
}
