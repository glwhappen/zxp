import { KINDS, METHODS } from '../shared.js'
import { checkOrigin, choice, field, json, objectBody, RequestError } from './core.js'
import {
  CATEGORIES, courseDetail, joinCourse, listCourses, listStages, markLearned,
  saveCourse, saveStage, stageDetail, THEMES,
} from './learning.js'
import { submitAnswer, submitFile } from './submissions.js'
import { identify } from './auth.js'

const version = '2026-07-28'
const legacy = ['2025-11-25', '2025-06-18', '2025-03-26']
const info = { name: 'zxp', version: '0.1.0' }
const capabilities = { tools: {} }
const cacheHints = { ttlMs: 0, cacheScope: 'public' }
const string = { type: 'string' }
const boolean = { type: 'boolean' }
const enumeration = values => ({ type: 'string', enum: values })
const array = items => ({ type: 'array', items, uniqueItems: true })
const visibility = enumeration(['public', 'private'])
const course = {
  title: string, description: string, category: enumeration(CATEGORIES), theme: enumeration(THEMES),
  visibility, stageIds: array(string),
  requires: { type: 'object', additionalProperties: array(string),
    description: '关卡依赖：{ 关卡 ID: [前置关卡 ID...] }。前置关卡必须排在当前关卡之前，全部学会后才能打开当前关卡。' },
}
const stage = {
  title: string,
  task: string,
  tutorial: { ...string, description: 'Markdown 教程。将 {{submit:answer}}、{{submit:screenshot}} 或 {{submit:file}} 放在独立段落中，安排已开启的提交框。' },
  methods: array(enumeration(METHODS)),
  required: { ...array(enumeration(KINDS)), description: '必填的提交方式，必须是 methods 中已开启的项。必填未提交时无法标记学会。' },
  visibility,
}
const id = (args, key) => field(args[key], key, 100)
const tools = new Map()

function tool(name, description, properties, required, run, readOnlyHint = false) {
  tools.set(name, {
    definition: {
      name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
      annotations: { readOnlyHint },
    },
    run,
  })
}

tool('course_list', '列出公开、自己创建或已经加入的课程。', { scope: enumeration(['public', 'owned', 'joined']) }, [],
  ({ DB }, user, args) => listCourses(DB, user, args.scope), true)
tool('course_get', '读取课程详情、关卡顺序和当前用户的学习进度。', { courseId: string }, ['courseId'],
  ({ DB }, user, args) => courseDetail(DB, user, id(args, 'courseId')), true)
tool('course_create', '创建课程。stageIds 按顺序引用已有的关卡，requires 配置关卡依赖。默认私有。', course, ['title'],
  ({ DB }, user, args) => saveCourse(DB, user, args))
tool('course_update', '更新自己创建的课程，保留课程 ID。先读取现有字段，再提交完整表单及 stageIds。', { courseId: string, ...course },
  ['courseId', 'title', 'description', 'category', 'theme', 'visibility', 'stageIds'],
  ({ DB }, user, args) => saveCourse(DB, user, args, id(args, 'courseId')))
tool('course_join', '将课程加入我的学习。', { courseId: string }, ['courseId'],
  ({ DB }, user, args) => joinCourse(DB, user, id(args, 'courseId')))
tool('stage_list', '列出可引用的公开关卡或自己拥有的关卡。', { scope: enumeration(['available', 'owned']) }, [],
  ({ DB }, user, args) => listStages(DB, user, args.scope), true)
tool('stage_get', '读取学习任务、Markdown 教程、聚合人数与自己的提交。', { stageId: string }, ['stageId'],
  ({ DB }, user, args) => stageDetail(DB, user, id(args, 'stageId')), true)
tool('stage_create', '创建独立的关卡。教程支持 Markdown，默认私有，required 中的提交方式必须先完成才能标记学会。', stage, ['title', 'task'],
  ({ DB }, user, args) => saveStage(DB, user, args))
tool('stage_update', '更新自己创建的关卡。先读取现有字段，再提交完整表单。', { stageId: string, ...stage },
  ['stageId', 'title', 'task', 'tutorial', 'methods', 'visibility'],
  ({ DB }, user, args) => saveStage(DB, user, args, id(args, 'stageId')))
tool('stage_mark_learned', '设置或撤销学会状态，同一个关卡在各课程中同步。', { stageId: string, learned: boolean, courseId: string },
  ['stageId', 'learned'], ({ DB }, user, args) => markLearned(DB, user, id(args, 'stageId'), args.learned, args.courseId))
tool('stage_submit_answer', '保存或替换自己在这个关卡的文本答案。', { stageId: string, answer: string, courseId: string },
  ['stageId', 'answer'], ({ DB }, user, args) => submitAnswer(DB, user, id(args, 'stageId'), args.answer, args.courseId))
tool('stage_submit_file', '上传或替换这个关卡的截图或文件。内容用标准 Base64 编码，编码前最多 2 MiB。',
  { stageId: string, kind: enumeration(['screenshot', 'file']), filename: string, base64: string, courseId: string },
  ['stageId', 'kind', 'filename', 'base64'], (env, user, args) => {
    const kind = choice(args.kind, ['screenshot', 'file'], '提交类型')
    const value = field(args.base64, '文件内容', 2_796_204)
    let bytes
    try { bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0)) } catch {
      throw new RequestError(400, 'Base64 文件内容无效。')
    }
    if (bytes.length > 2 * 1024 * 1024) throw new RequestError(413, 'MCP 文件上限为 2 MiB。')
    return submitFile(env, user, id(args, 'stageId'), kind, args.filename, bytes, args.courseId)
  })

export async function handleMcp(request, env) {
  checkOrigin(request)
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  let rpc
  try { rpc = await objectBody(request, 2_900_000) } catch (error) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } }, error.status ?? 400)
  }
  const response = { jsonrpc: '2.0', id: rpc.id ?? null }
  const declared = request.headers.get('MCP-Protocol-Version')
  const methodHeader = request.headers.get('Mcp-Method')
  const nameHeader = request.headers.get('Mcp-Name')
  const modern = rpc.method === 'server/discover' || declared === version || methodHeader !== null
  const success = result => json({ ...response, result: modern
    ? { ...result, _meta: { 'io.modelcontextprotocol/serverInfo': info } } : result })
  const fault = (code, message) => json({ ...response, error: { code, message } })
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return fault(-32600, 'Invalid request')
  if (declared && ![version, ...legacy].includes(declared) && rpc.method !== 'initialize') {
    return json({ ...response, error: { code: -32022, message: 'Unsupported protocol version',
      data: { supported: [version, ...legacy], requested: declared } } }, 400)
  }
  if ((methodHeader && rpc.method !== methodHeader) || (nameHeader && rpc.params?.name !== nameHeader)) {
    return json({ ...response, error: { code: -32020, message: 'MCP headers do not match the request body' } }, 400)
  }
  if (!Object.hasOwn(rpc, 'id')) return new Response(null, { status: 202 })
  switch (rpc.method) {
    case 'server/discover':
      return success({ supportedVersions: [version, ...legacy], capabilities, ...cacheHints })
    case 'initialize':
      return success({ protocolVersion: legacy.includes(rpc.params?.protocolVersion) ? rpc.params.protocolVersion : legacy[0],
        serverInfo: info, capabilities })
    case 'ping':
      return success({})
    case 'tools/list':
      return success({ tools: [...tools.values()].map(tool => tool.definition), ...(modern ? cacheHints : {}) })
    case 'tools/call': {
      const tool = tools.get(rpc.params?.name)
      const args = rpc.params?.arguments ?? {}
      if (!tool || typeof args !== 'object' || Array.isArray(args)) return fault(-32602, 'Invalid tool or arguments')
      const { properties, required } = tool.definition.inputSchema
      if (required.some(key => !Object.hasOwn(args, key)) || Object.keys(args).some(key => {
        if (!Object.hasOwn(properties, key)) return true
        return properties[key].type === 'array' ? !Array.isArray(args[key]) : typeof args[key] !== properties[key].type
      })) return fault(-32602, 'Invalid tool arguments')
      const user = await identify(request, env.DB, true)
      if (!user) return json({ ...response, error: { code: -32001, message: '请先连接账号或提供有效的 MCP 令牌。' } },
        401, { 'WWW-Authenticate': 'Bearer' })
      try {
        return success({ content: [{ type: 'text', text: JSON.stringify(await tool.run(env, user, args)) }] })
      } catch (error) {
        if (!(error instanceof RequestError)) console.error(error)
        return success({ isError: true, content: [{ type: 'text',
          text: error instanceof RequestError ? error.message : '请求失败，请稍后重试。' }] })
      }
    }
    default:
      return fault(-32601, 'Method not found')
  }
}
