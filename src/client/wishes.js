import { icon } from './icons.js'
import { button, coursePath, esc, key, link, note } from './views.js'

export const wishPath = id => '/wishes/' + key(id)

const day = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
function dateLabel(value) {
  const iso = value.replace(' ', 'T') + 'Z'
  return `<time datetime="${esc(iso)}">${esc(day.format(new Date(iso)))}</time>`
}

function statusLabel(status) {
  return status === 'closed' ? '<span class="wish-status closed">已完结</span>'
    : '<span class="wish-status">讨论中</span>'
}

export function wishBoard(data) {
  const labels = [['open', '讨论中'], ['closed', '已完结'], ['all', '全部']]
  const messages = { open: '还没有讨论中的许愿。', closed: '还没有已完结的许愿。', all: '还没有课程许愿。' }
  return `<div class="page-heading section-head"><div><h1>课程许愿</h1>
    <p>说说你想学什么、想怎么学。找到合适的课程，也可以回来分享。</p></div>
    ${button('wish-new', '发布许愿', 'btn primary', 'plus')}</div>
    <section class="wish-board">
      <div class="filter-row wish-filters" role="group" aria-label="筛选许愿">
        ${labels.map(([status, label]) => button('wish-filter', label, 'filter', null,
          `data-status="${status}" aria-pressed="${data.status === status}"`)).join('')}
      </div>
      ${data.items.length ? `<ul class="wish-list">${data.items.map(item => `<li>
        <a href="${wishPath(item.id)}" data-link>
          <div class="wish-list-main"><div class="wish-list-title">${statusLabel(item.status)}<strong>${esc(item.title)}</strong></div>
            <p>${esc(item.preview)}</p><div class="subtle">${esc(item.author)} · ${dateLabel(item.updated_at)}</div></div>
          <div class="wish-counts"><span>${icon('text', 16)} ${item.replyCount} 条回复</span>
            <span>${icon('link', 16)} ${item.courseCount} 门课程</span></div>
          ${icon('chevron', 17)}
        </a></li>`).join('')}</ul>` : note(messages[data.status], 'spark')}
      ${data.page > 1 || data.hasNext ? `<div class="wish-pages">
        ${button('wish-page', '上一页', 'btn', null, `data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}`)}
        <span class="subtle">第 ${data.page} 页</span>
        ${button('wish-page', '下一页', 'btn', null, `data-page="${data.page + 1}" ${data.hasNext ? '' : 'disabled'}`)}
      </div>` : ''}
    </section>`
}

export function wishForm() {
  return `<form data-form="wish-create">
    <label>希望有什么课程<input name="title" maxlength="120" placeholder="例如，给新手的 SQL 数据分析实战" required></label>
    <label>想学什么<textarea name="goal" maxlength="4000" rows="4" placeholder="写下你想掌握的内容，或希望完成的作品" required></textarea></label>
    <label>想怎么学 <span class="subtle">选填</span><textarea name="approach" maxlength="3000" rows="3"
      placeholder="例如，希望用真实数据练习，每关能提交一份结果"></textarea></label>
    <div class="form-error" role="alert" hidden></div>
    <div class="submit-row"><button class="btn primary">发布许愿</button></div>
  </form>`
}

export function wishHeading(wish) {
  const open = wish.status === 'open'
  return `<div class="wish-meta">${statusLabel(wish.status)}<span class="subtle">${esc(wish.author)} 发布于 ${dateLabel(wish.created_at)}</span></div>
    <div class="section-head wish-title"><h1>${esc(wish.title)}</h1>
      ${wish.mine ? button('wish-status', open ? '标记完结' : '重新打开', open ? 'btn done' : 'btn',
        open ? 'check' : 'spark', `data-status="${open ? 'closed' : 'open'}"`) : ''}
    </div>`
}

export function wishDiscussion(wish) {
  return `${wish.replies.before ? `<div class="wish-older">${button('wish-older', '查看更早的回复', 'btn', 'up')}</div>` : ''}
    ${wish.replies.items.length ? `<ol class="wish-thread">${wish.replies.items.map(reply => `<li>
      <div class="wish-byline"><span class="avatar">${esc(reply.author.slice(0, 1))}</span>
        <strong>${esc(reply.author)}</strong><span class="subtle">${dateLabel(reply.created_at)}</span></div>
      <p class="wish-text">${esc(reply.body)}</p>
    </li>`).join('')}</ol>` : '<p class="subtle wish-empty-replies">还没有回复。</p>'}`
}

export function wishCourses(wish) {
  return wish.courses.length ? `<ul class="wish-course-list">${wish.courses.map(course => `<li>
    <a data-link href="${coursePath(course)}"><span class="step-text"><strong>${esc(course.title)}</strong>
      <small>${esc(course.category)} · ${esc(course.linkedBy)} 推荐</small></span>${icon('arrow', 16)}</a>
    ${wish.mine ? `<div class="wish-reactions" role="group" aria-label="${esc(course.title)} 的反馈">
      ${[['up', '点赞'], ['down', '点踩']].map(([reaction, label]) =>
        button('wish-vote', label, 'filter', reaction === 'up' ? 'up' : 'down',
          `data-id="${esc(course.id)}" data-reaction="${course.reaction === reaction ? 'none' : reaction}" aria-pressed="${course.reaction === reaction}"`)).join('')}
    </div>` : course.reaction ? `<p class="subtle wish-recommendation">许愿者已${course.reaction === 'up' ? '点赞' : '点踩'}</p>` : ''}
  </li>`).join('')}</ul>` : '<p class="subtle wish-empty-links">还没有关联课程。</p>'
}

export function wishPage(wish, user) {
  return `<p class="breadcrumb">${link('/wishes', '课程许愿', 'back', 'left')}</p>
    <header class="lesson-header wish-header" data-wish-heading>${wishHeading(wish)}</header>
    <div class="wish-layout">
      <div>
        <section class="outline-card wish-description">
          <h2>想学什么</h2><p class="wish-text">${esc(wish.goal)}</p>
          ${wish.approach ? `<h2>想怎么学</h2><p class="wish-text">${esc(wish.approach)}</p>` : ''}
        </section>
        <section class="outline-card">
          <h2>讨论</h2>
          <div data-wish-discussion>${wishDiscussion(wish)}</div>
          ${user ? `<form class="wish-reply" data-form="wish-reply">
            <label>回复<textarea name="body" rows="4" maxlength="4000" placeholder="分享建议、学习路线或课程线索" required></textarea></label>
            <div class="form-error" role="alert" hidden></div><div class="submit-row"><button class="btn primary">发布回复</button></div>
          </form>` : button('login', '登录后回复', 'btn', 'user')}
        </section>
      </div>
      <aside class="outline-card wish-related">
        <div class="section-head"><h2>关联课程</h2>${button('wish-picker', '关联课程', 'btn', 'link')}</div>
        <div data-wish-courses>${wishCourses(wish)}</div>
      </aside>
    </div>`
}

export function wishCoursePicker(courses) {
  if (!courses.length) return note('没有其他可关联的公开课程。')
  return `<label>搜索公开课程<input type="search" maxlength="100" placeholder="输入课程名称或作者" data-wish-course-filter></label>
    <div class="stage-options">${courses.map(course => `<button type="button" class="stage-option" data-action="wish-attach"
      data-id="${esc(course.id)}"><span class="step-text"><strong>${esc(course.title)}</strong>
      <small>${esc(course.author)} · ${esc(course.category)}</small></span>${icon('plus', 17)}</button>`).join('')}</div>
    <p data-wish-picker-empty class="subtle" hidden>没有符合条件的课程。</p>`
}
