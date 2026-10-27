# 资产库 API

基于 go-zero 的单体 REST 服务，实现数据库就绪检查、用户注册登录、项目创建、查询及协同编辑。
骨架由 goctl 1.10.1 从 asset.api 生成，业务实现位于 internal/logic。

## 启动

在项目根目录配置 .env 中的 POSTGRES_PASSWORD，再执行：

```powershell
docker compose up -d --wait
powershell -ExecutionPolicy Bypass -File scripts/migrate.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-backend.ps1
```

也可直接设置 DATABASE_URL 后，在 backend 中执行 `go run .`。
默认监听 127.0.0.1:8888。数据库连接池最多 10 个连接，检查超时 2 秒。
开发数据库映射 127.0.0.1:15432，数据保存于 Compose 命名卷。
修改已初始化数据库的密码需要修改数据库角色密码，不能仅改 .env。

## 生成与验证

```powershell
goctl api validate -api asset.api
goctl api go -api asset.api -dir . --style go_zero
go mod tidy
go build ./...
go test ./...
curl.exe -i http://127.0.0.1:8888/api/v1/health
```

迁移位于 migrations/，由 cmd/migrate 执行。已有 users、sessions、projects、project_collaborators 表，projects.version 用于协同编辑乐观锁。
Model 基础文件由 goctl model pg datasource 生成；多表事务及列表查询在 internal/model/store.go 中维护，使用 pgx 驱动、database/sql 和参数化 SQL。
当前未引入 GORM。业务逻辑放在 internal/logic，Handler 仅做解析及 Cookie 设置。

登录会话有效期 7 天，数据库只保存随机令牌的 SHA-256 摘要。退出立即撤销会话。
CookieSecure 默认 false。当前内网生产方案选择 HTTP，因此保持 false；未来切换 HTTPS 时必须设为 true。
AllowedOrigin 默认 http://127.0.0.1:5173，部署时须改为实际网页 Origin。
BootstrapAdminUsername 对应 `BOOTSTRAP_ADMIN_USERNAME`，用于初始化首名管理员。
账号使用 2–32 位唯一用户名登录，用户名不区分英文字母大小写；姓名为 1–60 个字符，仅作为作者、编辑者等位置的展示名称。迁移前的已有账号会从邮箱前缀生成用户名，发生重复时追加用户 ID。
当前尚未实现登录限流和过期会话定时清理。

项目内容允许所有登录员工编辑。更新事务先锁定项目并校验版本，成功后版本加 1；过期版本返回 409。
只有作者或管理员可增减共创者，普通编辑者变更成员列表返回 403。

项目创建和编辑会在同一数据库事务中写入 project_versions 不可变快照。历史按版本倒序分页且仅供查看，不提供版本恢复接口。旧数据库中的恢复记录仍可展示；文件与评论操作不进入内容历史。

管理员可以授予或撤销其他普通管理员，系统始终保留至少一名管理员且不允许撤销超级管理员权限。只有 `BOOTSTRAP_ADMIN_USERNAME` 指定的超级管理员可以删除员工账号；删除会撤销会话并匿名化账号，但保留项目、文件、评论和历史关系。普通管理员不能删除账号，也不能重置超级管理员密码。项目作者和管理员可以删除项目；级联删除的附件正文通过现有清理队列重试移除。

评论与回复存储在 comments 表：一级评论按时间倒序、回复按时间正序展示。所有登录员工可发表；评论及回复不允许单独删除，只会在删除所属项目时级联清理。
回复只允许一级，不支持嵌套；评论操作不会更新项目内容的修改时间和版本号。相关 SQL 集中在 `internal/model/comments.go`。

## 文件存储

UploadDir 默认 ../uploads（相对 backend 工作目录），生产环境必须设置为持久化卷绝对路径。
tusd v2.8.0 以 Go 库方式集成；标准 tus 传输路由在入口中单独挂载，业务 JSON 接口由 goctl 生成。
AllowedOrigin 同时用于上传 Location，必须与网页入口完全一致，开发环境用 http://127.0.0.1:5173。
上传按 8 MiB 分段，传输接口单请求最大 16 MiB，单文件最多 5,000,000,000 字节。
下载直接流式读取文件，支持 Range；强制 attachment 与 nosniff，原始 HTML 等文件不在站内执行。
项目文件支持整个项目或指定文件夹使用 ZIP Store 实时打包下载，不生成临时压缩包、不整体载入内存；文件夹下载只包含所选目录并保留内部结构，同名文件在包内自动编号。
普通项目文件与演示材料通过 kind 隔离。演示模块启用后才接受演示材料；图片、PDF、MP4 使用固定 MIME 白名单和安全响应头在线预览，其他格式仅下载。
上传、下载和预览路由关闭 go-zero 的缓冲超时中间件；tusd 保留其网络读超时。
每次续传都验证会话和上传者，所有员工均可下载已登记附件，但不能接管他人的未完成上传。
完成接口校验实际文件长度并幂等登记附件。所有登录员工可以删除已登记的项目文件与演示材料，不提供文件替换。
删除事务提交后，正文进入 file_cleanup 队列；后台每 5 秒删除正文及 .info，失败则保留队列继续重试。
未完成上传暂时保留供续传；生产前需补充配额、空间预留和过期任务清理。
