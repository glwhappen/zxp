import { marked } from 'marked'

export const submissionKinds = ['answer', 'screenshot', 'file']
export const submissionMarker = kind => `{{submit:${kind}}}`

function markerKind(token) {
  if (token.type !== 'paragraph') return
  return /^\{\{submit:(answer|screenshot|file)\}\}$/.exec(token.raw.trim())?.[1]
}

export function hasSubmissionMarker(markdown, kind) {
  return marked.lexer(markdown).some(token => markerKind(token) === kind)
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
  const markers = tokens.map(markerKind)
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
  function addSubmissions(end, slots) {
    const html = marked.parser(tokens.slice(start, end))
    if (html.trim()) blocks.push({ html })
    for (const kind of slots) {
      if (remaining.delete(kind)) blocks.push({ kind })
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    if (markers[index]) {
      addSubmissions(index, [markers[index]])
      start = index + 1
    } else if (scheduled.has(index)) {
      addSubmissions(index, scheduled.get(index))
      start = index
    }
  }
  addSubmissions(tokens.length, scheduled.get(tokens.length) ?? [])
  return { blocks, remaining: [...remaining] }
}
