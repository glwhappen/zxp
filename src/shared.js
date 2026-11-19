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

// 课程标签：作者能设前三个，精品只留给管理员。
export const COURSE_LABELS = {
  draft: { name: '编写中', hint: '还在写，内容会继续调整' },
  done: { name: '完结', hint: '内容已经完整' },
  'co-create': { name: '期待共创', hint: '欢迎一起补关卡' },
  featured: { name: '精品', hint: '管理员推荐', adminOnly: true },
}
export const AUTHOR_LABELS = ['draft', 'done', 'co-create']
export const ADMIN_LABELS = ['featured']

export function courseLabelKeys(raw) {
  const list = parseList(raw)
  return Object.keys(COURSE_LABELS).filter(key => list.includes(key))
}
