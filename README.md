# 技能工坊

技能工坊是一个用实战关卡组织课程的学习网站。作者编写任务和教程，选择提交方式，再把独立关卡编排成课程。学习者可以加入课程，随时标记学会、提交答案、上传截图或上传文件。网页和 MCP 共用同一套数据及权限。

## 五分钟体验

需要 Node.js 22.12 或更新的版本及 npm。在仓库根目录运行以下命令。

```sh
npm ci
npm run db:migrate
npm run dev
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。探索页预置了四门示例课程，首次读取时写入示例内容。注册一个本地账号，打开「AI 绘图实战入门」的「配置大模型 API」。配置客户端后可以直接填写答案，验证连接后可以上传截图。需要记录完成情况时，用页首的「标记学会了」。再打开「AI 视频创作工作流」，就能看到同一关卡的状态和答案。

在「创建课程」里填写课程资料，然后新建关卡或从关卡库引用已有的关卡。新关卡也可以直接在关卡库里创建。保存前可以调整关卡顺序和移除引用。在关卡的编辑界面可用 Markdown 编写教程。

在教程里把光标放到练习题后，再点击编辑器的「插入文本答案」「插入截图上传」或「插入文件上传」。这些按钮会开启相应的提交方式，并插入 Markdown 标记。使用 MCP 编辑教程时，可以在带空行的独立段落写入 `{{submit:answer}}`、`{{submit:screenshot}}`、`{{submit:file}}`，并在 `methods` 中开启对应方式。每种提交显示一次。有明确插入位置时，其他已开启的提交放在该教程末尾。完全没有插入标记的教程会按原有的步骤或段落安排提交框。

本地账号与文件保存在当前工作区的 `.wrangler/state/`。重新启动会继续使用这些数据。停止服务按 Ctrl+C。换端口可运行 `npm run dev -- --port 8788`。

## 学习与创作规则

| 操作 | 行为 |
| --- | --- |
| 引用关卡 | 一门课程按顺序引用多个独立关卡，同一个关卡可以被不同课程引用。仅作者可以编辑原关卡。 |
| 公开课程 | 公开课程进入探索页。发布前，所引用关卡须全部公开。公开关卡出现在关卡库，其他作者可以引用。 |
| 学会与提交 | 每个关卡都可以独立切换「学会了」。作者按需开启文本、截图和文件，每种方式保留最新提交，可随时覆盖。网页单个附件最多 10 MB。 |
| 学习进度 | 学会标记以用户和关卡为键，同一账号在所有引用课程中共享进度。课程进度统计已标记学会的关卡。 |
| 人数统计 | 每种提交方式按用户去重。参与人数是标记学会或提交过任意一种作业的用户并集。 |
| 提交隐私 | 提交内容和附件只对提交者可见。课程作者和访客看到聚合人数。 |

课程和关卡创建时默认私有。关卡被公开课程或其他作者引用期间，原作者必须先解除相关引用才能把关卡改为私有。

## 通过 MCP 创建课程

MCP 端点为 `/mcp`，使用无状态 Streamable HTTP。托管实例通过 Sites 发布时生成的个人插件连接 ChatGPT 或 Codex。连接后，助手以该账号访问课程和关卡，创建结果也会出现在网页的「我的创作」中。

本地开发时，登录后在「MCP 连接」里生成个人令牌。使用 `http://127.0.0.1:8787/mcp`，在 MCP 客户端中配置固定请求头 `Authorization: Bearer <令牌>`。轮换后旧令牌立刻失效。兼容 `server/discover` 和早期客户端使用的 `initialize`。协议和请求格式见 [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)。

| 工具 | 用途 |
| --- | --- |
| `course_list`、`course_get` | 浏览公开、自己的或已加入的课程，查看关卡顺序和进度 |
| `course_create`、`course_update`、`course_join` | 创建、更新或加入课程 |
| `stage_list`、`stage_get` | 查找可引用关卡，读取教程、统计和自己的提交 |
| `stage_create`、`stage_update` | 创建或更新独立关卡 |
| `stage_mark_learned`、`stage_submit_answer`、`stage_submit_file` | 切换学会状态，提交答案或附件 |

`course_create` 的 `stageIds` 数组决定关卡顺序。下面的工具调用引用两个示例关卡。

```json
{
  "name": "course_create",
  "arguments": {
    "title": "AI 视频练习",
    "description": "先验证模型连接，再完成短片。",
    "category": "AI 创作",
    "visibility": "private",
    "stageIds": ["api-setup", "video-shots"]
  }
}
```

创建新关卡时先调用 `stage_create`，再把返回的 ID 放进 `stageIds`。更新时先读取记录，再传入完整表单。MCP 上传使用标准 Base64，单文件编码前最多 2 MiB。

## 代码和数据

- `src/client/` 提供探索、学习、创作和 MCP 连接页面。教程的 Markdown 由 Marked 解析，经 DOMPurify 处理后渲染。
- `src/server/worker.js` 是 HTTP 入口。`mcp.js` 是 MCP 入口。两者复用 `learning.js` 和 `submissions.js` 的权限、数据校验与写入逻辑。
- `drizzle/` 保存 D1 的 SQL 迁移。`course_stages` 保存课程与关卡的多对多引用。`progress` 的主键是关卡与用户，`submissions` 额外使用提交类型。
- `scripts/` 构建浏览器资源和 Worker。本地由 Wrangler 提供 D1、R2 和账号会话。Sites 部署使用 `npm run build`，生成 `dist/server/index.js`，由 Sites 提供登录身份、D1 和 R2。
- `test/` 在隔离的 Worker 环境里覆盖跨课程进度、两账号的权限边界、上传替换、人数去重及 MCP 创建课程。

托管构建信任 Sites 网关注入的用户身份。其他环境使用 `npm run dev` 运行本地账号版本；直接移植到其他托管环境时，须接入可信身份校验。仓库中的 Wrangler 数据库 ID 是本地模拟用的占位符。

## 参与开发

1. 从 `main` 拉出功能分支。一次改动围绕一个功能或修复。
2. 在网页与 MCP 共用的业务模块实现权限及写入规则。改动数据结构时新增 SQL 迁移并追加迁移日志，保留已应用的迁移。
3. 提交前运行 `npm test` 和 `npm run build`。涉及页面时验证登录后的正常入口，涉及权限时至少验证两个账号。
4. 在 Pull Request 里描述用户可以观察到的变化，列出验证步骤。涉及新迁移或配置时说明如何应用。

账号凭据、个人令牌、上传文件和构建产物留在各自的运行环境中。
