import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lessonBlocks, lessonPayload, mergeTextBlocks, updateBlock } from '../src/client/quick-lesson.js'
import { tutorialTokens, widgetMarker } from '../src/client/tutorial.js'

test('continuous Markdown stays together and preserves its complete source', () => {
  const markdown = '## 配置账号\n\n第一段。\n\n第二段。\n\n- 检查密钥\n- 检查模型\n\n|模型|状态|\n|---|---|\n|示例|可用|\n\n![截图](/image.png)\n\n[文档][doc]\n\n[doc]: https://example.org\n'
  const blocks = lessonBlocks(markdown)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[0].raw, markdown)
})

test('only real interactive markers split the editor and existing answer keys survive', () => {
  const markdown = '## 开始\n\n先阅读。\n\n```md\n{{ask:代码示例}}\n```\n\n{{ask:新问题|甲,乙|key=原来的问题}}\n\n## 上传\n\n检查结果。\n\n{{submit:screenshot|上传成功页面}}\n\n完成。\n'
  const blocks = lessonBlocks(markdown)
  assert.deepEqual(blocks.map(block => block.type), ['text', 'question', 'text', 'screenshot', 'text'])
  assert.equal(blocks[1].fieldKey, '原来的问题')
  assert.equal(blocks.map(block => block.raw).join(''), markdown)
})

test('removing an interaction rejoins surrounding text without joining through other fields', () => {
  const blocks = lessonBlocks('左边。\n\n{{ask:账号}}\n\n右边。\n\n{{submit:file|上传配置}}\n\n最后。')
  const firstId = blocks[0].id
  const merged = mergeTextBlocks(blocks.filter(block => block.type !== 'question'))
  assert.deepEqual(merged.map(block => block.type), ['text', 'file', 'text'])
  assert.equal(merged[0].id, firstId)
  assert.match(merged[0].raw, /左边。\n\n右边。/)
})

test('grouping text leaves enabled submissions and required answer identities intact', () => {
  const markdown = '第一段。\n\n第二段。\n\n{{ask:改过的文字||key=account}}\n\n第三段。\n\n{{submit:screenshot|上传截图}}\n'
  const payload = lessonPayload({ title: '课程', alias: 'lesson', task: '练习', blocks: lessonBlocks(markdown), enabled: ['screenshot'], required: ['screenshot'], requiredFields: ['account', 'removed'] })
  assert.equal(payload.tutorial, markdown)
  assert.deepEqual(payload.requiredFields, ['account'])
  assert.deepEqual(payload.required, ['screenshot'])
})

test('rejoining text preserves indentation in Markdown code blocks', () => {
  const blocks = lessonBlocks('说明。\n\n{{ask:准备好了吗}}\n\n    const key = "example"\n    run(key)\n')
  const merged = mergeTextBlocks(blocks.filter(block => block.type === 'text'))
  assert.equal(merged.length, 1)
  assert.match(merged[0].raw, /\n\n    const key/)
})

test('quick editing treats prompts and optional notes as editable blocks without changing answer identities', () => {
  const source = ['一段正文。', widgetMarker('prompt', '原题', '第一条提示词'), '{{ask:账号||key=original}}', widgetMarker('details', '可选说明', '## 补充\n\n两段文字。')].join('\n\n')
  const blocks = lessonBlocks(source)
  assert.deepEqual(blocks.map(block => block.type), ['text', 'prompt', 'question', 'details'])
  assert.equal(blocks[2].fieldKey, 'original')
  updateBlock(blocks[1], { dataset: { quickProperty: 'content' }, value: '保留换行\n{{submit:file|字面内容}}\n' })
  updateBlock(blocks[3], { dataset: { quickProperty: 'title' }, value: '为什么这样做' })
  assert.equal(tutorialTokens(blocks[1].raw)[0].widget.content, '保留换行\n{{submit:file|字面内容}}\n')
  assert.equal(tutorialTokens(blocks[3].raw)[0].widget.title, '为什么这样做')
})
