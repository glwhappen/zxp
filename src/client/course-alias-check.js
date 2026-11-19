import { esc } from './views.js'

export function mountCourseAliasCheck(form, { api, courseId, isCurrent }) {
  const input = form.querySelector('input[name="alias"]')
  const status = form.querySelector('[data-course-alias-status]')
  if (!input || !status) return
  let timer
  let request = 0
  const value = () => input.value.trim().toLowerCase()
  const active = () => form.isConnected && isCurrent()
  function show(result) {
    if (!active() || value() !== result.alias) return
    status.className = 'alias-status' + (result.available ? ' available' : ' unavailable')
    input.setAttribute('aria-invalid', String(!result.available))
    input.setCustomValidity(result.available ? '' : '这个课程地址已被使用，请换一个别名。')
    if (result.available) {
      status.textContent = '可用：/course/' + result.alias
      return
    }
    const conflict = result.conflict
    status.innerHTML = `<span>${conflict.accessible
      ? `这个地址已由「${esc(conflict.title)}」使用${conflict.system ? '（系统示例课程）' : conflict.owned ? '（你的课程）' : ''}。`
      : '这个地址已被其他课程使用。'}${conflict.usesId ? '占用的是课程原始 ID，别名为空也会保留该地址。' : ''}</span>
      <span class="alias-actions">${conflict.accessible ? `<a href="${esc(conflict.path)}" target="_blank" rel="noopener noreferrer">打开占用课程 ↗</a>` : ''}
      ${result.suggestion ? `<button type="button" class="text-btn" data-alias-suggestion="${esc(result.suggestion)}">使用 ${esc(result.suggestion)}</button>` : ''}</span>`
  }
  function schedule() {
    clearTimeout(timer)
    const version = ++request
    input.setCustomValidity('')
    input.removeAttribute('aria-invalid')
    status.className = 'alias-status'
    status.replaceChildren()
    const alias = value()
    if (!alias || !input.checkValidity()) return
    timer = setTimeout(async () => {
      if (!active()) return
      status.textContent = '正在检查地址…'
      try {
        const result = await api('course-alias?alias=' + encodeURIComponent(alias)
          + (courseId ? '&courseId=' + encodeURIComponent(courseId) : ''))
        if (version === request) show(result)
      } catch (error) {
        if (!active() || version !== request) return
        status.textContent = error.message
        status.className = 'alias-status unavailable'
      }
    }, 300)
  }
  function click(event) {
    const button = event.target.closest('[data-alias-suggestion]')
    if (!button || !active()) return
    input.value = button.dataset.aliasSuggestion
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }
  input.addEventListener('input', schedule)
  status.addEventListener('click', click)
  return {
    show,
    dispose() {
      clearTimeout(timer)
      request++
      input.removeEventListener('input', schedule)
      status.removeEventListener('click', click)
    },
  }
}
