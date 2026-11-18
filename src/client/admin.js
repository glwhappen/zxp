import { icon } from './icons.js'
import { COURSE_LABELS } from '../shared.js'
import { button, esc, note } from './views.js'

export const providerNames = { chatgpt: 'ChatGPT', password: '账号密码', oidc: 'OIDC' }

export function adminPage({ counts, courses, users, settings, q }) {
  const metrics = [['账号', 'users'], ['课程', 'courses'], ['关卡', 'stages'], ['提交', 'submissions']]
  const configuredMethods = [
    ['chatgpt', 'ChatGPT 登录', '使用 ChatGPT 账号进入知行谱。'],
    ['password', '账号密码', '允许用户注册账号并用用户名和密码登录。'],
    ['oidc', settings.oidcLabel, settings.available.oidc ? '由已接入的身份服务负责登录与注册。' : '部署配置中尚未提供 OIDC 连接信息。'],
  ]
  return `<div class="page-heading"><h1>管理后台</h1></div>
    <dl class="admin-metrics">${metrics.map(([title, id]) =>
      `<div class="form-panel"><dt>${title}</dt><dd>${esc(counts[id])}</dd></div>`).join('')}</dl>
    <div class="admin-panels">
      <section class="outline-card">
        <h2>登录方式</h2>
        <form class="admin-login-form" data-form="admin-login">
          ${configuredMethods.filter(([id]) => id !== 'chatgpt' || settings.available.chatgpt).map(([id, name, description]) =>
            `<label class="admin-method">
              <input type="checkbox" name="${id}" ${settings.methods[id] ? 'checked' : ''} ${settings.locked || !settings.available[id] ? 'disabled' : ''}>
              <span><strong>${esc(name)}</strong><small class="subtle">${esc(description)}</small></span>
            </label>`).join('')}
          ${settings.locked ? '<p class="subtle">登录方式由部署配置管理。</p>'
            : '<div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">保存登录方式</button></div>'}
        </form>
      </section>
      <section class="outline-card">
        <div class="section-head"><h2>课程管理</h2><span class="subtle">最多显示 50 门</span></div>
        <form class="admin-search" data-form="admin-search">
          <input name="q" type="search" value="${esc(q)}" maxlength="100" aria-label="按课程或作者搜索" placeholder="课程名称或作者">
          <button class="btn">${icon('search', 16)} 搜索</button>
        </form>
        ${courses.length ? `<div class="admin-table"><table>
          <thead><tr><th>课程</th><th>状态</th><th>标签</th><th>操作</th></tr></thead>
          <tbody>${courses.map(course => `<tr><td><strong>${esc(course.title)}</strong><small>${esc(course.author)}</small></td>
            <td>${course.moderated_at ? '已下架' : course.visibility === 'public' ? '公开' : '私有'}</td>
            <td><div class="admin-labels">${(course.labels ?? []).map(key => `<span class="label label-${key}">${esc(COURSE_LABELS[key]?.name ?? key)}</span>`).join('') || '<span class="subtle">—</span>'}</div></td>
            <td><div class="admin-actions">${button('admin-course', course.moderated_at ? '恢复' : '下架', 'btn', null,
              `data-id="${esc(course.id)}" data-hidden="${!course.moderated_at}"`)}
              ${button('admin-featured', (course.labels ?? []).includes('featured') ? '取消精品' : '设为精品', 'btn', null,
                `data-id="${esc(course.id)}" data-featured="${!(course.labels ?? []).includes('featured')}"`)}</div></td></tr>`).join('')}</tbody>
        </table></div>` : note('没有符合条件的课程。')}
      </section>
      <section class="outline-card">
        <div class="section-head"><h2>账号</h2><span class="subtle">最多显示 50 个</span></div>
        ${users.length ? `<div class="admin-table"><table>
          <thead><tr><th>昵称</th><th>登录方式</th><th>账号 ID</th></tr></thead>
          <tbody>${users.map(user => `<tr><td>${esc(user.name)}</td><td>${esc(providerNames[user.provider])}</td><td><code>${esc(user.id)}</code></td></tr>`).join('')}</tbody>
        </table></div>` : note('还没有注册用户。', 'user')}
      </section>
    </div>`
}
