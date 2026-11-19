import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasAskMarker, hasSubmissionMarker, layoutTutorial, submissionSpecs, tutorialTokens } from '../src/client/tutorial.js'

test('submissions without markers stay at the end of the tutorial', () => {
  const markdown = '## 获取密钥\n\n记录模型名称。\n\n## 配置客户端\n\n填写配置。\n\n## 验证连接\n\n检查模型的回复。'
  const { blocks, remaining } = layoutTutorial(markdown, ['answer', 'screenshot'])
  assert.deepEqual(remaining, ['answer', 'screenshot'])
  assert.equal(blocks.length, 1)
  assert.match(blocks[0].html, /验证连接/)
})

test('inline markers retain author order and ignore fenced or duplicate markers', () => {
  const markdown = [
    '先看[参考文档][doc]。',
    '```md\n{{submit:answer|写下你的答案}}\n```',
    '{{submit:screenshot|上传一张截图}}',
    '再试一次。',
    '{{submit:answer|写下你的答案}}',
    '{{submit:answer|写下你的答案}}',
    '回顾结果。',
    '[doc]: https://example.org/guide',
  ].join('\n\n')
  const { blocks, remaining } = layoutTutorial(markdown, ['answer', 'screenshot', 'file'])
  assert.deepEqual(blocks.filter(block => block.kind).map(block => block.kind), ['screenshot', 'answer'])
  assert.match(blocks[0].html, /href="https:\/\/example\.org\/guide"/)
  assert.match(blocks[0].html, /<code[^>]*>\{\{submit:answer\|写下你的答案\}\}/)
  assert.match(blocks.at(-1).html, /回顾结果/)
  assert.deepEqual(remaining, ['file'])
  assert.equal(hasSubmissionMarker('```md\n{{submit:answer|写下你的答案}}\n```', 'answer'), false)
  assert.equal(hasSubmissionMarker(markdown, 'answer'), true)
})

test('ask markers render in place with their options', () => {
  const markdown = [
    '## 第一步',
    '{{ask:你准备做哪一类？|模板,教案,表格}}',
    '{{ask:补充一句}}',
    '{{submit:answer|写下你的答案}}',
  ].join('\n\n')
  const { blocks, remaining } = layoutTutorial(markdown, ['answer'])
  assert.match(blocks[0].html, /第一步/)
  assert.deepEqual(blocks[1].field, { name: '你准备做哪一类？', options: ['模板', '教案', '表格'] })
  assert.deepEqual(blocks[2].field, { name: '补充一句', options: [] })
  assert.equal(blocks[3].kind, 'answer')
  assert.deepEqual(remaining, [])
  assert.equal(hasAskMarker(markdown, '补充一句'), true)
  assert.equal(hasAskMarker(markdown, '没写过的项'), false)
})

test('ask markers render inline without producing submission slots', () => {
  const markdown = '## 第一步\n\n先想一想。\n\n{{ask:你的方向？}}\n\n## 第二步\n\n动手做。'
  const { blocks, remaining } = layoutTutorial(markdown, ['answer', 'file'])
  assert.deepEqual(remaining, ['answer', 'file'])
  assert(blocks.some(block => block.field?.name === '你的方向？'))
  assert(!blocks.some(block => block.kind))
})

test('a single submission kind stays at the end of the tutorial', () => {
  const markdown = '## 第一步\n\n先想一想。\n\n## 第二步\n\n动手做。\n\n## 第三步\n\n复盘与交付。'
  const { blocks, remaining } = layoutTutorial(markdown, ['answer'])
  assert.deepEqual(remaining, ['answer'])
  assert.equal(blocks.filter(block => block.kind).length, 0)
})

test('submission markers keep their prompt text', () => {
  const markdown = '## 练习\n\n{{submit:answer|写下 3 个候选品类和理由}}'
  const { blocks } = layoutTutorial(markdown, ['answer'])
  assert.deepEqual(blocks[1], { kind: 'answer', prompt: '写下 3 个候选品类和理由' })
  assert.deepEqual(submissionSpecs(markdown), [{ kind: 'answer', prompt: '写下 3 个候选品类和理由' }])
})

test('edited question labels retain their original answer key and token source is lossless', () => {
  const markdown = '## 我的教程\n\n{{ask:现在的标题|选项一,选项二|key=原来的问题}}\n\n~~~text\n{{ask:代码里的标记}}\n~~~\n'
  assert.equal(hasAskMarker(markdown, '原来的问题'), true)
  assert.equal(hasAskMarker(markdown, '现在的标题'), false)
  assert.equal(tutorialTokens(markdown).map(block => block.raw).join(''), markdown)
  assert.deepEqual(layoutTutorial(markdown, []).blocks.find(block => block.field).field, {
    name: '现在的标题', options: ['选项一', '选项二'], key: '原来的问题',
  })
})
