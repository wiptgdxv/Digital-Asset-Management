# AI 开发交接：数字资产管理中心

更新时间：2026-10-24（Asia/Shanghai）

## 1. 项目目标

这是部署在公司内网、主要面向 PC 浏览器的数字资产与项目管理软件。员工自行注册，所有项目对全员可见；所有注册员工都能编辑项目内容。作者和管理员负责共创者管理。

已完成项目协同编辑、只读编辑历史、项目评论与回复、`@用户名` 站内提醒、管理员授权与项目删除，以及演示材料上传和受限格式预览。

## 2. 技术栈与边界

- 前端：React 19、TypeScript 5.8、Vite 6、react-markdown、remark-gfm、tus-js-client。
- 后端：Go 1.27.2、go-zero 1.10.3、database/sql + pgx。
- 数据库：PostgreSQL 17。
- 文件传输：后端内嵌 tusd 2.8，原文件存储，单文件上限 5,000,000,000 字节。
- 架构：模块化单体 REST API。当前不使用 RPC、Redis、消息队列、JWT 或 ORM。
- 开发端口：前端 5173、后端 8888、PostgreSQL 15432，均绑定 127.0.0.1。
- 生产目标：浪潮 x86_64 服务器上的麒麟 Linux。目标机 `uname -m` 已确认为 `x86_64`，默认按 `linux/amd64` 打包；仍需取得 `/etc/os-release` 和 Docker Compose 版本，不能把 Windows 开发验证当作目标机验收。
- 生产部署文件已经补齐：`backend/Dockerfile`、`frontend/Dockerfile`、`compose.production.yaml`、`deploy/nginx.conf`、`deploy/deploy.sh`、`deploy/backup.sh` 和 `scripts/package-linux-amd64.ps1`。当前按用户选择使用内网 HTTP，`COOKIE_SECURE=false`；离线包不包含密码、数据库或上传正文。

## 3. 必须遵守的开发方式

1. 先完整阅读根目录 `AGENTS.md`。
2. 修改 go-zero 后端前，阅读 `.ai-context/ai-context/00-instructions.md`，再按任务阅读其 workflows、tools、patterns，以及 `.ai-context/zero-skills` 中相关参考。
3. API 先改 `backend/asset.api`，执行校验与 goctl 生成，再补 Logic/Model；保持 Handler → Logic → Model。
4. 数据库只追加新迁移，不能回改已经执行的迁移。
5. 不提交 `.env`、密码、会话、上传正文、数据库文件或测试截图。
6. 文件上传、下载和预览路由必须保持流式处理，不得恢复 go-zero 正文缓冲超时。
7. 当前工作树没有基线业务提交，大量文件显示为未跟踪；这些都是现有项目文件，不要清理或覆盖。

## 4. 目录导航

```text
AGENTS.md                         项目规则与业务约束
README.md                         总览、启动与完成度
backend/asset.api                 REST API 单一事实来源
backend/internal/handler/         goctl 路由处理层
backend/internal/logic/           参数验证与业务错误映射
backend/internal/model/store.go   SQL、事务、项目协同更新
backend/internal/model/comments.go 评论、回复查询与写入
backend/internal/model/history.go  历史快照写入与分页查询
backend/internal/files/           tus 上传和文件清理
backend/migrations/               顺序数据库迁移
backend/API.md                    接口语义说明
frontend/src/main.tsx             工作区、列表、详情与页面切换
frontend/src/ProjectForm.tsx      创建项目
frontend/src/ProjectEdit.tsx      协同编辑与冲突 UI
frontend/src/CommentsPanel.tsx    评论与一级回复
frontend/src/NotificationsPanel.tsx  提及提醒列表与全部已读
frontend/src/ProjectHistory.tsx   只读编辑历史与折叠展示
frontend/src/AdminPanel.tsx       管理员授权界面
frontend/src/PasswordPanel.tsx    普通改密与临时密码强制改密
frontend/src/FilesPanel.tsx       项目文件上传/下载与演示材料直接展示、管理
frontend/src/api.ts               API 客户端与共享类型
frontend/src/style.css            全局视觉样式
frontend/tests/                   Playwright 业务验收
scripts/migrate.ps1               读取 .env 并执行迁移
scripts/start-backend.ps1         读取 .env 并启动 API
```

## 5. 已实现业务能力

- 员工自行注册、登录、退出、刷新恢复会话。
- 数据库存储 Session；Cookie 为 HttpOnly、SameSite=Strict；所有写操作校验 CSRF。
- 项目创建：名称、简介、分类、Markdown、共创者、演示模块开关；提交前查询完全同名项目并二次确认，但仍允许同名。
- 项目广场和我的项目：搜索、分类、排序、分页。
- GitHub README 风格 Markdown 展示；本地导入 UTF-8 `.md`/`.markdown`，最大 200 KB；不执行 Markdown 中的原始 HTML。
- 项目详情展示作者、共创者、发布时间、最近修改与编辑者；吸顶分区导航按说明、演示、文件、评论、历史定位内容。
- 项目草稿：创建和编辑的文字字段、分类、演示开关及共创者按用户和项目隔离保存在浏览器 7 天，进入页面时选择恢复或删除；成功保存后清除，不持久化文件对象。
- 账号使用“姓名（展示）+ 唯一用户名（登录）+ 密码”，注册和登录接口不再接收邮箱；用户名为 3–32 位并忽略英文字母大小写。旧账号迁移时从邮箱前缀生成用户名。
- 忘记密码由管理员重置：生成 18 位临时密码且只向管理员返回一次，撤销目标用户全部会话并记录重置人/时间；临时密码登录后，中间件强制先修改密码。正常改密和强制改密都会撤销其他设备会话。
- 项目原文件：新增和删除在编辑页暂存，只有点击顶部“保存修改”后才按顺序执行；多文件队列支持 tus 续传、暂停/重试、单文件下载、单文件夹 ZIP 下载、整个项目 ZIP 下载和删除，单文件 5 GB。文件夹 ZIP 只包含已保存文件并保留所选文件夹内部结构。所有登录员工可添加或删除，不提供替换。详情页只读并提供预览/下载。
- 项目文件一键下载：整个项目和指定文件夹均使用 ZIP Store 流式输出，不创建临时压缩包；文件夹 ZIP 保留所选目录内部结构，同名文件自动编号。
- 演示材料：与项目文件隔离，复用 tus 和 5 GB 上限；开关位于编辑页“文件与演示”页签的演示材料标题栏，启用后在原处立即显示上传区并允许暂存文件，统一保存时必须先落库 `demoEnabled` 再上传材料，放弃编辑时两者一起取消；关闭且存在待上传材料时必须二次确认。图片、PDF、MP4 在详情页直接展示，其他格式仅显示信息；前端不显示下载入口，后端普通下载接口也拒绝演示材料。
- 协同编辑：所有注册员工均可更新项目内容。
- 共创者管理：仅作者能增减；共创者的“我的项目”会同步变化；普通编辑者不会自动成为共创者。
- 乐观锁：客户端提交 `version`；成功后加 1；过期版本返回 HTTP 409，前端保留草稿并提示加载最新版。
- 评论与一级回复：评论列表始终展示，每条评论的回复默认折叠并可独立展开和收起；全员可发表，评论及回复均不提供删除能力，仅在项目删除时级联清理；评论操作不更新项目修改时间。正文中的 `@用户名` 为有效的其他用户创建持久化站内提醒，重复、未知和自提及忽略；前端每 30 秒刷新未读数。
- 编辑历史：项目创建和编辑写入不可变快照；默认显示最新一条，可展开查看按版本倒序分页的全部记录，只读展示且不提供版本恢复。旧数据库中的恢复记录仍兼容展示。

## 6. 协同编辑实现语义

接口：`PUT /api/v1/projects/:id`，需要 Session Cookie 和 `X-CSRF-Token`。

请求主体：

```json
{
  "version": 3,
  "name": "项目名称",
  "summary": "简介",
  "readme": "# Markdown",
  "category": "软件",
  "demoEnabled": false,
  "collaboratorIds": [2, 8]
}
```

事务规则：

- `SELECT ... FOR UPDATE` 锁定项目，并比较数据库版本和请求版本。
- 版本不一致：409，不执行任何更新。
- 普通员工可改内容，但提交的共创者集合必须与数据库一致；否则 403。
- 作者可替换共创者集合。作者本人会被自动排除，重复 ID 会去重，不存在的用户使事务回滚并返回 400。
- 保存成功：更新 `last_editor_id`、`updated_at`，并执行 `version = version + 1`。
- 项目文件上传会更新最近编辑者和修改时间，但不增加内容版本号；版本号只保护协同编辑表单字段。
- 作者和管理员可以管理共创者；普通编辑者不能借编辑接口改变成员。

前端冲突行为：

- 409 后继续保留当前表单草稿，不自动覆盖。
- 用户点击“重新加载最新版本”才放弃草稿并获取服务器最新版。
- 含未保存修改时离开编辑页会确认；浏览器刷新/关闭也有离开提示。

## 7. 数据库迁移

- `001_initial.sql`：users、sessions、projects、project_collaborators。
- `002_files.sql`：项目附件、临时上传关联等。
- `003_file_cleanup_trigger.sql`：旧文件持久化清理队列。
- `004_project_version.sql`：给 projects 增加 `version BIGINT NOT NULL DEFAULT 1`。
- `005_comments.sql`：评论与回复表。
- `006_comment_content_constraint.sql`：数据库层限制评论内容为 1–2000 字。
- `007_project_history.sql`：项目历史快照表，并为既有项目建立 baseline。
- `008_admin_role.sql`：用户管理员标记和管理员索引。
- `009_demo_files.sql`：上传记录与项目文件增加 project/demo 类型及组合索引。
- `010_username_auth.sql`：用户名登录迁移与唯一约束。
- `011_notifications.sql`：评论提及提醒、已读状态和查询索引。
- `012_password_reset.sql`：强制改密状态与最后一次管理员重置记录。
- `013_folder_uploads.sql`：上传记录和正式文件的相对目录字段，以及项目目录查询索引。

迁移器通过 `schema_migrations` 记录版本、事务执行并使用 PostgreSQL advisory lock，可重复运行。

## 8. 本地启动

根目录先复制 `.env.example` 为 `.env` 并设置本机密码；不要把 `.env` 交给其他 AI 或提交仓库。

```powershell
docker compose up -d --wait
powershell -ExecutionPolicy Bypass -File scripts/migrate.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-backend.ps1
```

另一个终端：

```powershell
Set-Location frontend
npm ci
npm run dev
```

访问 `http://127.0.0.1:5173`。没有默认用户和演示数据。

## 9. 修改后必须验证

```powershell
Set-Location backend
goctl api validate --api asset.api
go test ./...
go build ./...

Set-Location ../frontend
npm run build
npx playwright test
```

2026-10-24 本轮实际结果：

- `goctl api validate`：通过。
- `go test ./...`：通过。
- `npm run build`：通过。
- `npx playwright test`：8/8 通过。
- `tests/collaboration.spec.ts` 覆盖全员编辑、版本冲突、成员权限、我的项目归属和编辑页冲突提示。
- `tests/comments.spec.ts` 覆盖评论、一级回复、提及提醒、重复/未知/自提及过滤、全部已读、删除接口移除、禁止嵌套、CSRF 和项目修改时间隔离。
- `tests/history.spec.ts` 覆盖历史记录、变化字段、恢复接口已移除、默认展示最新记录及展开全部交互。
- `tests/admin.spec.ts` 覆盖管理员授予、管理员重置密码、旧会话撤销、临时密码强制修改、越权删除、管理员删除和作者确认删除。最后管理员保护由业务代码保留，但共享开发库存在固定 `admin`，浏览器测试不再假设库中只有测试管理员。
- `tests/demo-files.spec.ts` 覆盖模块开关、文件类型隔离、旧替换请求拦截、预览白名单、安全响应头、演示材料禁止下载和详情页直接展示。
- `tests/uploads.spec.ts` 覆盖文件夹相对路径校验、列表返回、整个项目及单文件夹 ZIP 目录结构和路径安全；`tests/workflow.spec.ts` 通过模拟目录拖放覆盖前端自动识别、上传及文件夹下载入口。
- 文件管理使用默认收起的递归文件树呈现目录结构；上传完成的临时队列项会移除，避免大量目录文件与正式列表重复平铺。
- 文件选择形成“待保存”任务并立即合并显示在正式文件使用的同一棵目录树中，但没有下载入口；删除形成可撤销的“待删除”状态。FilesPanel 通过 imperative `commit()` 在 ProjectEdit 顶部保存时统一执行，保存前不得调用正式上传完成或删除接口。
- 文件树的文件行展示格式、大小、上传者和时间；文件夹行可递归切换全部后代文件的待删除状态，实际删除仍由统一保存提交。
- 创建和编辑项目的共创者选择默认不加载员工名单；只有查询以 `@` 开头时才按姓名或用户名搜索，点选后加入待保存共创者。
- 评论和回复输入框提供 @ 员工选择器，按姓名或用户名调用 `/users?q=` 搜索，最终插入唯一用户名以兼容后端提醒解析。
- 冲突页截图已人工检查，布局在 1440×1000 视口正常；截图位于被忽略的 `frontend/test-results/`，不应提交。

测试会创建 UUID 隔离账号，并在 finally 中只清理本轮账号和项目。运行 Playwright 前必须启动 PostgreSQL、迁移、后端和前端。

## 10. 后续功能优先级

尚未实现，不能向用户宣称已经完成：

1. 评论分页、编辑，以及提醒单条已读/实时推送（当前评论一次加载全部，提醒每 30 秒轮询且仅支持全部已读）。
2. 登录限流、过期会话清理、磁盘配额、空间预留、未完成上传过期清理。
3. 公司内网生产部署：Linux、Nginx、HTTP 内网边界、持久化卷、备份恢复、5 GB 实传压测与监控；若扩大网络范围则切换 HTTPS 和 Secure Cookie。

## 11. 已知注意点

- 项目全员可见且全员可编辑是当前明确业务规则，不要误改为仅作者/共创者可编辑。
- 仅“我的项目”按作者或共创者过滤；普通编辑者不会出现在其中。
- Markdown 导入只保存文本，不自动上传其中引用的本地图片。
- 文件删除会先提交数据库事务，再由持久化清理队列异步删除正文；清理失败必须重试。
- 5 GB 是十进制字节数，不是 5 GiB。
- API 错误统一为 `{"message":"可展示文本"}`，不要把数据库错误或内部路径返回前端。
