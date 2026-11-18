import { statement } from './core.js'

const AUTHOR = 'workshop-examples'
const AUTHOR_NAME = '知行谱'
const stages = [
  ['api-setup', '配置大模型 API', '配置一个大模型 API，并成功发出一次测试请求。', `## 1. 获取 API 密钥

登录你选用的模型服务控制台，创建一个用于练习的密钥。记下服务商提供的 API 基础地址和模型名称。

## 2. 配置客户端

在客户端设置里填写 API 基础地址、模型名称和密钥。使用环境变量或客户端的密钥设置保存密钥。

## 3. 验证连接

发送一条简短消息，例如「用一句话回答：现在连接成功了吗？」。确认客户端收到模型回复。如果请求失败，依次检查地址、权限、模型名称和配额。

提交时写下你使用的模型和验证方法，或上传测试结果截图。请遮挡密钥和其他账号信息。`, ['learned', 'answer', 'screenshot']],
  ['image-prompt', '写出第一条绘图提示词', '围绕同一个主体，生成两张构图不同的图片。', `## 从主体和场景开始

先描述主体、动作和环境，再补充镜头、光线和风格。例如「雨夜窗边的一盏纸灯，近景，暖光，深蓝色背景」。

## 只改一个变量

保持主体和场景不变，将「近景」改成「俯拍全景」。比较画面空间和信息量，记录提示词中最有效的变化。`, ['learned', 'answer', 'screenshot']],
  ['image-finish', '迭代并整理你的作品', '选一张初稿，完成一次迭代并整理成小作品。', `## 对比初稿与成稿

挑出最需要改进的一处，例如主体不清晰或光线太平。修改相关描述并生成新版本。

把提示词、生成设置和对比图放进同一个项目文件夹。提交一张对比截图或打包后的作品文件。`, ['learned', 'screenshot', 'file']],
  ['video-shots', '把想法拆成三个镜头', '写一个三镜头分镜，并标出每个镜头的动作。', `## 为每个镜头分配一个画面任务

用第一个镜头交代场景，第二个镜头展示变化，第三个镜头给出结果。为每个镜头写下景别、主体动作和画面时长。`, ['learned', 'answer', 'file']],
  ['video-cut', '导出第一条短片', '把镜头剪成一条节奏清晰的短片。', `## 拼接和检查

先按分镜顺序拼接。检查首尾画面、字幕、音量和转场，再导出一个能播放的版本。可以提交文件或有代表性的截图。`, ['learned', 'screenshot', 'file']],
  ['web-structure', '搭建网页的内容结构', '用语义化 HTML 写出一个包含标题、正文与导航的页面。', `## 先写页面大纲

明确页面标题、主要内容和导航。用 \`header\`、\`nav\`、\`main\` 等元素组织结构，再用浏览器打开，确认页面可以按逻辑顺序阅读。`, ['learned', 'answer', 'file']],
  ['web-responsive', '让页面适配手机', '在窄屏和宽屏下检查同一个页面。', `## 从窄屏开始设计

给容器设定合理的最大宽度，让内容在窄屏单列排列。使用浏览器的响应式预览检查文字、图片和操作按钮。`, ['learned', 'screenshot', 'file']],
  ['writing-plan', '设计一个可执行的写作流程', '把写作任务拆成选题、提纲、撰写和校对。', `## 为每一步定义产出

选题先回答「写给谁」，提纲列出读者要解决的问题，撰写补充论证和例子，校对检查事实与语气。`, ['learned', 'answer']],
  ['writing-review', '写一段并做一次修订', '写一段开头，并提交你做过的一次具体修改。', `## 从读者的问题出发

写完初稿后，找出一句难懂或重复的话。修改它并对比两版，再写一句话说明改动理由。`, ['learned', 'answer', 'file']],
]

const courses = [
  ['ai-image', 'AI 绘图实战入门', '从配置模型到完成第一张作品，建立自己的 AI 绘图工作流。', 'AI 创作', 'violet', ['api-setup', 'image-prompt', 'image-finish']],
  ['ai-video', 'AI 视频创作工作流', '从分镜脚本到成片，制作你的第一条 AI 短片。', 'AI 创作', 'peach', ['api-setup', 'video-shots', 'video-cut']],
  ['web-basics', '网页开发基础', '用 HTML 和 CSS 搭出一个清晰、可访问的响应式网页。', '编程开发', 'blue', ['web-structure', 'web-responsive']],
  ['ai-writing', '用 AI 搭建写作流程', '把写作拆成可以反复练习的步骤，从提纲走到第一轮修订。', '效率工具', 'mint', ['writing-plan', 'writing-review']],
]

const seeded = new WeakSet()

export async function seedExamples(db) {
  if (seeded.has(db)) return
  const author = await statement(db, 'SELECT name FROM users WHERE id = ?', AUTHOR).first()
  if (author) {
    if (author.name !== AUTHOR_NAME) {
      await statement(db, 'UPDATE users SET name = ? WHERE id = ?', AUTHOR_NAME, AUTHOR).run()
    }
    seeded.add(db)
    return
  }
  const queries = [statement(db, 'INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)', AUTHOR, AUTHOR_NAME)]
  for (const [id, title, task, tutorial, methods] of stages) {
    queries.push(statement(db, `
      INSERT OR IGNORE INTO stages (id, owner_id, title, task, tutorial, methods, visibility)
      VALUES (?, ?, ?, ?, ?, ?, 'public')
    `, id, AUTHOR, title, task, tutorial, JSON.stringify(methods)))
  }
  for (const [id, title, description, category, theme, stageIds] of courses) {
    queries.push(statement(db, `
      INSERT OR IGNORE INTO courses (id, owner_id, title, description, category, theme, visibility)
      VALUES (?, ?, ?, ?, ?, ?, 'public')
    `, id, AUTHOR, title, description, category, theme))
    stageIds.forEach((stageId, position) => queries.push(statement(db,
      'INSERT OR IGNORE INTO course_stages VALUES (?, ?, ?)', id, stageId, position)))
  }
  await db.batch(queries)
  seeded.add(db)
}
