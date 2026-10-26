# 数字资产管理中心

公司内网项目资产库，面向电脑浏览器。当前已实现员工注册登录、项目创建与协同编辑、项目广场、我的项目和 Markdown 详情，以及项目评论、回复和 `@用户名` 站内提醒。

## 技术方案

- 前端：React、TypeScript、Vite。
- 后端：Go、go-zero，单个业务 API 服务。
- 数据库：PostgreSQL。
- 文件：内嵌 tusd Go 库、tus-js-client、服务器持久化目录，单文件最大 5 GB（5,000,000,000 字节）。
- 部署目标：浪潮 x86_64 服务器上的麒麟 Linux，采用 `linux/amd64` 容器、Docker Compose 与 Nginx；须在真实目标机完成兼容性验收。

## 已验证的本机工具

| 工具 | 版本 |
| --- | --- |
| Go | 1.27.2 windows/amd64 |
| Node.js | 22.16.0 |
| npm | 10.9.2 |
| Git | 2.46.0.windows.1 |
| goctl | 1.10.1 windows/amd64 |
| Docker CLI | 29.8.0 |
| Docker Compose | 5.5.1 |

版本检测通过不等于项目依赖兼容性已经验证；生成工程后需执行构建和测试。

## AI 开发资料

项目通过 AGENTS.md 引用两个固定提交的 Git 子模块：

- `.ai-context/ai-context`：go-zero 工作流程。
- `.ai-context/zero-skills`：详细模式和 goctl 参考。

克隆项目后恢复资料：

```powershell
git submodule update --init --recursive
```

当前直接通过终端调用 goctl，不需要 mcp-zero。子模块不会自动追踪上游变化。

## 本地启动

首次使用：复制 `.env.example` 为 `.env`，设置自己的 POSTGRES_PASSWORD。
正式初始化时同时设置 `BOOTSTRAP_ADMIN_USERNAME`，用于指定首名管理员。
当前开发电脑已生成仅保存在本机、被 Git 忽略的 .env。

```powershell
docker compose up -d --wait
powershell -ExecutionPolicy Bypass -File scripts/migrate.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-backend.ps1
```

另开终端，在 frontend 目录执行 `npm ci` 和 `npm run dev`。
访问 http://127.0.0.1:5173，自行注册账号后登录。没有默认账号或预置项目。
停止开发数据库使用 `docker compose stop`，保留数据卷。

项目默认端口：前端 5173、后端 8888、PostgreSQL 15432，全部绑定本机。
这是 Windows 本地开发配置，不等同于公司内网麒麟 x86_64 生产部署。上传服务内嵌于 Go 后端，无需独立启动 tusd。

详细说明见 backend/README.md、backend/API.md 和 frontend/README.md。

## 麒麟 Linux x86_64 生产部署

目标服务器 `uname -m` 已确认为 `x86_64`，Docker 平台名对应 `linux/amd64`。仓库提供前后端多阶段 Dockerfile、HTTP Nginx、生产 Compose、自动迁移、离线镜像打包以及备份脚本。当前按用户选择使用纯 HTTP，只适用于可信且隔离的公司内网。

在 Windows 开发机生成离线发布包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-linux-amd64.ps1 -Version 1.0.8 -PublicOrigin http://192.168.1.100:9009
```

把生成的 `release/digital-assets-1.0.8-linux-amd64` 整个目录传到服务器。发布包已生成可直接使用的 `.env.production` 和随机数据库密码，按照其中的 `deploy/README.md` 执行部署即可：

```bash
bash deploy/deploy.sh
```

数据库和上传正文保存在 Docker 持久化卷中，不进入镜像；升级时使用新版本标签，不得删除数据卷。完整部署、验收、升级和备份步骤见 [deploy/README.md](deploy/README.md)。

## 已实现

- 用户名注册、bcrypt 密码摘要、登录、退出和刷新后恢复会话；姓名仅用于界面展示。
- 忘记密码由管理员生成一次性临时密码；旧会话立即撤销，员工使用临时密码登录后必须设置新密码。
- 数据库存储会话，浏览器使用 HttpOnly / SameSite=Strict Cookie；写操作校验 CSRF 令牌。
- 创建项目：名称、简介、分类、Markdown、共创者及演示模块开关。
- 项目说明从本地 .md / .markdown 导入（UTF-8，最大 200 KB），支持覆盖确认、继续编辑和预览。
- 项目广场与我的项目，支持名称/简介搜索、分类、时间排序及每页 20 条分页。
- 项目详情展示作者、共创者、时间和 Markdown；使用吸顶分区导航定位说明、演示、文件、评论和历史，禁用原始 HTML 执行。
- 创建同名项目时会列出已有数量并要求确认，但不强制名称唯一。
- 全员可编辑项目内容；保存采用版本号乐观锁，发生并发修改时不覆盖他人内容并提示加载最新版。
- 创建和编辑项目的文字、分类、演示开关及共创者草稿在当前浏览器保留 7 天，可选择恢复或删除；文件本体不会写入浏览器草稿。
- 项目作者可增减共创者；普通编辑者不能改成员，共创关系会同步影响“我的项目”。
- 版本化数据库迁移（事务、迁移记录、并发锁），可以重复运行。
- 项目原始文件支持多选，也可把文件或整个文件夹拖入同一区域；程序自动识别并保留目录结构。新增和删除先暂存，点击编辑页顶部“保存修改”后才按队列上传或删除，支持暂停/重试/续传、单文件下载、单文件夹 ZIP 下载和整个项目 ZIP 下载。
- 项目文件支持一键流式打包下载；所有员工均可添加或删除项目文件与演示材料。
- 可选演示材料区与项目文件隔离；图片、PDF、MP4 在详情页直接展示，其他格式仅显示文件信息，演示材料不提供下载。
- 删除后的文件正文进入持久化删除队列，每 5 秒重试清理；不提供文件替换功能。
- 项目评论与回复：全员可发表和查看；每条评论下的回复默认折叠并可独立展开、收起；评论和回复均不允许删除，各限 2000 字；使用 `@用户名` 会生成站内提醒。
- 项目编辑历史默认展示最近一次修改，可展开查看按版本倒序排列的全部记录；历史仅供查看，不提供版本恢复。
- 管理员可授予或撤销管理员、重置其他员工密码；系统保留至少一名管理员。项目作者和管理员可删除项目。

## 尚未实现

评论编辑与富文本。
生产上线前还需补齐登录限流、过期会话清理、备份及部署验收；当前 HTTP 部署不提供传输加密，后续跨网段使用时必须评估切换 HTTPS。
上传目前没有磁盘配额、空间预留和未完成上传的定时过期清理；上传中断可以续传。
5 GB 上限已验证协议边界，尚未做实际 5 GB 完整传输压测；上线前须结合内网带宽与磁盘完成验收。

## 验证

后端在 backend 目录执行 `go build ./...`、`go test ./...`；当前业务集成验证集中于浏览器测试。
前端在 frontend 目录执行 `npm run build`。
服务启动后，在 frontend 执行 `npx playwright install chromium`、`npx playwright test`。
测试使用 UUID 独立账号和项目，结束时只删除本轮测试数据；需本地 Docker PostgreSQL 运行。
