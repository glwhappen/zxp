import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasAskMarker, hasSubmissionMarker, layoutTutorial } from '../src/client/tutorial.js'

test('legacy tutorials place submissions between their existing steps', () => {
  const markdown = '## 获取密钥\n\n记录模型名称。\n\n## 配置客户端\n\n填写配置。\n\n## 验证连接\n\n检查模型的回复。'
  const { blocks, remaining } = layoutTutorial(markdown, ['answer', 'screenshot'])
  assert.match(blocks[0].html, /配置客户端/)
  assert.doesNotMatch(blocks[0].html, /验证连接/)
  assert.equal(blocks[1].kind, 'answer')
  assert.match(blocks[2].html, /验证连接/)
  assert.equal(blocks[3].kind, 'screenshot')
  assert.deepEqual(remaining, [])
})

test('inline markers retain author order and ignore fenced or duplicate markers', () => {
  const markdown = [
    '先看[参考文档][doc]。',
    '```md\n{{submit:answer}}\n```',
    '{{submit:screenshot}}',
    '再试一次。',
    '{{submit:answer}}',
    '{{submit:answer}}',
    '回顾结果。',
    '[doc]: https://example.org/guide',
  ].join('\n\n')
  const { blocks, remaining } = layoutTutorial(markdown, ['answer', 'screenshot', 'file'])
  assert.deepEqual(blocks.filter(block => block.kind).map(block => block.kind), ['screenshot', 'answer'])
  assert.match(blocks[0].html, /href="https:\/\/example\.org\/guide"/)
  assert.match(blocks[0].html, /<code[^>]*>\{\{submit:answer\}\}/)
  assert.match(blocks.at(-1).html, /回顾结果/)
  assert.deepEqual(remaining, ['file'])
  assert.equal(hasSubmissionMarker('```md\n{{submit:answer}}\n```', 'answer'), false)
  assert.equal(hasSubmissionMarker(markdown, 'answer'), true)
})

test('ask markers render in place with their options', () => {
  const markdown = [
    '## 第一步',
    '{{ask:你准备做哪一类？|模板,教案,表格}}',
    '{{ask:补充一句}}',
    '{{submit:answer}}',
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
