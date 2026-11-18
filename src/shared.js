// 网页与 MCP 共用的关卡规则：提交方式、必填项与前置依赖。
export const KINDS = ['answer', 'screenshot', 'file']
export const METHODS = ['learned', ...KINDS]
export const LABELS = { learned: '学会了', answer: '文本答案', screenshot: '截图上传', file: '文件上传' }

export function parseList(value) {
  try {
    const list = JSON.parse(value ?? '[]')
    return Array.isArray(list) ? list.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

// 已开启的提交方式：学会了恒可用，其余来自关卡设置的数组。
export function enabledMethods(raw) {
  const selected = parseList(raw)
  return METHODS.filter(method => method === 'learned' || selected.includes(method))
}

// 必填项必须同时是已开启的提交方式，历史数据里多余的项直接忽略。
export function requiredMethods(rawRequired, methods) {
  const selected = parseList(rawRequired)
  return KINDS.filter(kind => methods.includes(kind) && selected.includes(kind))
}

export function missingRequired(required, submitted) {
  return required.filter(kind => !submitted.includes(kind))
}

export function kindLabels(kinds) {
  return kinds.map(kind => LABELS[kind] ?? kind).join('、')
}
