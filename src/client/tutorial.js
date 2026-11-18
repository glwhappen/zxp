import { marked } from 'marked'

export const submissionKinds = ['answer', 'screenshot', 'file']
export const submissionMarker = kind => `{{submit:${kind}}}`
export const askMarker = (question, options = []) =>
  `{{ask:${question}${options.length ? '|' + options.join(',') : ''}}}`

function markerKind(token) {
  if (token.type !== 'paragraph') return
  return /^\{\{submit:(answer|screenshot|file)\}\}$/.exec(token.raw.trim())?.[1]
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
  return marked.lexer(markdown).some(token => markerKind(token) === kind)
}

export function hasAskMarker(markdown, name) {
  return marked.lexer(markdown).some(token => askField(token)?.name === name)
}

function sectionEndIndexes(tokens) {
  const ends = []
  let hasContent = false
  tokens.forEach((token, index) => {
    if (token.type === 'heading') {
      if (hasContent) ends.push(index)
      hasContent = false
    } else if (token.type !== 'space') {
      hasContent = true
    }
  })
  if (!ends.length) {
    tokens.forEach((token, index) => {
      if (token.type === 'paragraph' && index + 1 < tokens.length) ends.push(index + 1)
    })
  }
  return [...ends, tokens.length]
}

export function layoutTutorial(markdown, kinds) {
  const tokens = marked.lexer(markdown)
  const markers = tokens.map(token => {
    const kind = markerKind(token)
    if (kind) return { kind }
    const field = askField(token)
    return field ? { field } : null
  })
  const explicit = markers.some(Boolean)
  const ends = explicit ? [] : sectionEndIndexes(tokens)
  const scheduled = new Map()
  if (!explicit) {
    kinds.forEach((kind, index) => {
      const boundary = kinds.length === 1 ? Math.floor((ends.length - 1) / 2)
        : Math.floor((index + 1) * ends.length / (kinds.length + 1))
      const end = ends[boundary]
      scheduled.set(end, [...(scheduled.get(end) ?? []), kind])
    })
  }

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
      if (remaining.delete(kind)) blocks.push({ kind })
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    if (markers[index]) {
      addSlots(index, [markers[index]])
      start = index + 1
    } else if (scheduled.has(index)) {
      addSlots(index, scheduled.get(index))
      start = index
    }
  }
  addSlots(tokens.length, scheduled.get(tokens.length) ?? [])
  return { blocks, remaining: [...remaining] }
}
