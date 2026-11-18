import { button, esc, note } from './views.js'

const shareModes = [
  ['owner', '仅作者可以编辑'],
  ['shared', '指定账号可以编辑'],
  ['public', '所有登录用户都可以编辑'],
]

const reasons = {
  initial: '初始版本', interval: '自动存档', structure: '编排变更前', manual: '手动存档',
  published: '开放协作', before_restore: '恢复前存档', restored: '恢复生成',
}

function timestamp(value) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value.replace(' ', 'T') + 'Z'))
}

export function editorChoices(sharing) {
  const accounts = sharing.results ?? []
  return `<div class="collaborator-pills">${sharing.editors.map(user =>
    `<span class="collaborator-pill">${esc(user.name)} ${button('remove-collaborator', '', 'icon-btn', 'close',
      `data-id="${esc(user.id)}" aria-label="移除 ${esc(user.name)}"`)}</span>`).join('') || '<span class="subtle">还没有选择协作者。</span>'}</div>
    ${accounts.length ? `<div class="stage-options">${accounts.map(user => `<button type="button" class="stage-option"
      data-action="add-collaborator" data-id="${esc(user.id)}" ${sharing.editors.some(editor => editor.id === user.id) ? 'disabled' : ''}>
      <span class="step-text"><strong>${esc(user.name)}</strong>${user.username ? `<small>@${esc(user.username)}</small>` : ''}</span>
      <span>${sharing.editors.some(editor => editor.id === user.id) ? '已添加' : '添加'}</span></button>`).join('')}</div>`
      : sharing.searched ? '<p class="subtle">没有找到匹配的账号。</p>' : ''}`
}

export function courseSharingForm(sharing) {
  return `<form data-form="course-sharing">
    <label>编辑权限<select name="mode">${shareModes.map(([mode, title]) =>
      `<option value="${mode}" ${sharing.mode === mode ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
    <p class="subtle" data-public-sharing-note ${sharing.mode === 'public' ? '' : 'hidden'}>
      开放协作会把课程设为公开，课程内须使用公开关卡。
    </p>
    <div class="collaborator-picker" data-collaborator-picker ${sharing.mode === 'shared' ? '' : 'hidden'}>
      <div class="inline-actions">
        <input type="search" maxlength="120" aria-label="搜索协作者" placeholder="昵称、用户名或账号 ID" data-collaborator-search>
        ${button('find-collaborators', '搜索账号', 'btn', 'search')}
      </div>
      <div data-collaborator-choices>${editorChoices(sharing)}</div>
    </div>
    <div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">保存共享设置</button></div>
  </form>`
}

export function courseHistory(history) {
  return `<p class="subtle">当前版本 ${history.revision}。可以从下列存档恢复课程资料、编排和讲义。</p>
    ${history.items.length ? `<ol class="course-version-list">${history.items.map(item => `<li>
      <span class="step-text"><strong>版本 ${item.revision} · ${esc(item.title)}</strong>
      <small>${esc(reasons[item.reason] ?? '课程存档')} · ${esc(item.author)} · ${esc(timestamp(item.saved_at))}</small></span>
      ${button('preview-course-version', '查看', 'btn', null, `data-id="${esc(item.id)}"`)}</li>`).join('')}</ol>` : note('还没有可查看的存档。')}
    ${history.before !== null ? button('more-course-versions', '更早的版本', 'btn', 'up', `data-before="${history.before}"`) : ''}`
}

export function courseVersionPreview(version) {
  return `<div class="course-version-preview">
    <div><h3>${esc(version.title)}</h3>${version.description ? `<p>${esc(version.description)}</p>` : ''}</div>
    <div><h3>关卡编排</h3>
      ${version.stages.length ? `<ol>${version.stages.map(stage => `<li>${esc(stage.title)}</li>`).join('')}</ol>`
        : '<p class="subtle">这个版本没有关卡。</p>'}</div>
    <div class="submit-row">${button('course-history', '返回历史版本')}
      ${button('restore-course-version', '恢复此版本', 'btn primary', null, `data-id="${esc(version.id)}"`)}</div>
  </div>`
}
