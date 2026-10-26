# 麒麟 Linux x86_64 内网 HTTP 部署

本目录用于部署由 `scripts/package-linux-amd64.ps1` 生成的离线发布包。生产服务器只需要 Docker Compose v2，不需要安装 Go、Node.js 或 goctl。

当前按用户选择使用纯 HTTP。账号口令、Cookie 和文件内容在网络上传输时不会加密，只应部署在完全可信、隔离且有访问控制的公司内网；后续若跨网段或接入无线网络，建议切换 HTTPS。

## 1. 服务器验收

```bash
uname -m
cat /etc/os-release
docker version
docker compose version
df -h
free -h
```

`uname -m` 必须为 `x86_64`（Docker 对应平台名为 `linux/amd64`）。请为 PostgreSQL、上传文件和备份预留容量；单文件允许 5,000,000,000 字节。

## 2. 准备发布包

在 Windows 开发机项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-linux-amd64.ps1 -Version 1.0.4 -PublicOrigin http://192.168.1.100:9009
```

把 `release/digital-assets-1.0.4-linux-amd64` 整个目录传到服务器，例如 `/opt/digital-assets/releases/1.0.4`。

## 3. 配置服务器

```bash
cd /opt/digital-assets/releases/1.0.4
```

发布包内已经包含 `.env.production`，数据库密码由打包脚本提前随机生成，无需在服务器上再次设置。打包时传入的访问地址应与员工浏览器实际使用的地址一致，例如：

```env
IMAGE_VERSION=1.0.4
ALLOWED_ORIGIN=http://192.168.1.100:9009
COOKIE_SECURE=false
BOOTSTRAP_ADMIN_USERNAME=admin
HTTP_PORT=9009
```

`ALLOWED_ORIGIN` 必须与员工浏览器实际地址完全一致，不能带结尾斜杠。当前默认使用 `9009` 端口，因此来源地址必须包含 `:9009`。

自动生成的数据库密码只包含十六进制字符，不需要进行 URL 百分号编码。`.env.production` 含有数据库凭据，不要发送到无关人员，也不要提交到 Git。

## 4. 首次部署与升级

```bash
bash deploy/deploy.sh
```

脚本会确认镜像为 `linux/amd64`、导入镜像、运行数据库迁移并启动服务。迁移使用数据库锁且可以重复执行。

查看状态和日志：

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=200 backend
docker compose --env-file .env.production -f compose.production.yaml logs --tail=200 frontend
```

升级时使用新版本号生成并上传新的发布目录，把上一版本的 `.env.production` 复制到新目录，只修改 `IMAGE_VERSION`，然后执行新目录中的 `deploy/deploy.sh`。不要删除 Docker 卷。

## 5. 初始化管理员

`BOOTSTRAP_ADMIN_USERNAME=admin` 时，首次注册用户名 `admin` 的员工会成为管理员。该设置不会创建账号或保存明文密码；账号仍需在登录页自行注册。已有同名账号会在后端启动时提升为管理员。

## 6. 验收

```bash
curl --fail --show-error http://192.168.1.100:9009/api/v1/health
```

正常响应：

```json
{"status":"ok","database":"ok"}
```

浏览器访问 `http://192.168.1.100:9009`（替换为服务器实际内网 IP）。还需验证登录、权限、项目编辑、评论提醒、目录上传、单文件下载、文件夹和项目 ZIP 下载、演示材料预览、容器重启后的数据持久化。上线前必须进行实际大文件传输和磁盘容量验收。

## 7. 备份

```bash
bash deploy/backup.sh /opt/digital-assets/backups
```

每个备份目录包含数据库自定义格式备份、上传目录压缩包和 SHA-256 校验文件。应把备份复制到与业务服务器不同的存储设备，并定期做恢复演练。

恢复属于破坏性操作，应先停止前端和后端、校验备份 SHA-256，并在隔离环境演练。数据库使用 `pg_restore` 恢复，上传文件解压回 `uploads-data` 卷；两者必须来自同一次备份。正式恢复前保留当前数据快照，不要直接覆盖唯一副本。

## 8. 网络边界

公司内网只需放通服务器的 TCP 9009。PostgreSQL 5432 和后端 8888 均未映射到宿主机。上传和下载通过 Nginx 流式代理，不会把 5 GB 文件整体载入内存。

建议通过防火墙只允许办公网段访问 9009 端口。HTTP 不提供传输加密，不应从互联网、访客网络或不可信无线网络访问。
