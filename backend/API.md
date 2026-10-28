# 接口

## GET /api/v1/health

无请求参数，无身份认证；用于开发联调和服务就绪检测。

- 200：`{"status":"ok","database":"ok"}`，数据库可连接。
- 503：`{"message":"数据库暂时不可用"}`，数据库连接失败或超时。

响应不包含数据库地址、凭据及内部错误。
此接口是 readiness 检查，不应当作独立于数据库的进程 liveness 检查。

## 账号

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| POST /api/v1/auth/register | name、username、password | message |
| POST /api/v1/auth/login | username、password | user、csrfToken、mustChangePassword、isSuperAdmin，并设置 Session Cookie |
| GET /api/v1/auth/me | 登录 Cookie | user、csrfToken、mustChangePassword、isSuperAdmin |
| POST /api/v1/auth/change-password | currentPassword、newPassword、X-CSRF-Token | message |
| POST /api/v1/auth/logout | 登录 Cookie、X-CSRF-Token | message，清除 Cookie |
| POST /api/v1/users/:id/reset-password | 管理员、用户 ID、X-CSRF-Token | temporaryPassword，仅返回一次 |
| DELETE /api/v1/users/:id | 超级管理员、用户 ID、X-CSRF-Token | message |

用户名为 2–32 个中英文字母、数字、点、下划线或短横线，英文字母不区分大小写；密码长度 8–72 字节；姓名为 1–60 个字符，因此“张三”等两字姓名和用户名均可注册。注册成功后需要登录。

忘记密码由管理员重置。重置会生成 18 位随机临时密码、记录最后一次重置人和时间，并撤销目标用户的全部会话。临时密码响应设置 `Cache-Control: no-store`，数据库只保存 bcrypt 摘要。管理员不能从该接口重置自己的密码，也不能重置超级管理员密码；超级管理员应使用修改密码接口。

使用临时密码登录时 `mustChangePassword=true`；修改完成前，Session 中间件只允许访问 `/auth/me`、`/auth/change-password` 和 `/auth/logout`。修改成功后保留当前会话并撤销同一用户的其他会话。

```json
{"name":"张三","username":"zhangsan","password":"change-this-password"}
```

```json
{"username":"zhangsan","password":"change-this-password"}
```

## 项目

以下接口都需要登录 Cookie；POST、PUT 等写操作还需要 X-CSRF-Token。

| 方法与路径 | 参数 | 响应 |
| --- | --- | --- |
| GET /api/v1/users | q（姓名或用户名，可选） | items，最多 50 人 |
| POST /api/v1/projects | name、summary、readme、category、demoEnabled、collaboratorIds | Project |
| GET /api/v1/projects | q、scope=all/mine、category、sort=updated/created、page | items、total，每页 20 条 |
| GET /api/v1/projects/:id | 项目 ID | Project |
| PUT /api/v1/projects/:id | version、name、summary、readme、category、demoEnabled、collaboratorIds | 更新后的 Project |

创建请求示例：

```json
{"name":"数据治理方案","summary":"整理交付规范","readme":"# 使用说明","category":"文档","demoEnabled":false,"collaboratorIds":[]}
```

Project 包含 id、version、name、summary、readme、category、demoEnabled、author、lastEditor、collaborators、createdAt、updatedAt。
User 包含 id、name、username、isAdmin。时间采用 RFC3339 UTC，前端按 Asia/Shanghai 展示。
作者同时作为首次编辑者。mine 包含本人创建或本人作为共创者的项目；项目不重复。
不存在的共创者使整个创建事务回滚。分类限定软件、设计、数据、文档、其他。

所有登录用户都能修改项目内容。更新请求必须携带最近读取到的 `version`；保存成功后版本加 1，过期版本返回 409，不会覆盖新内容。
项目作者和管理员可以增减共创者；普通编辑者必须原样提交成员列表，否则返回 403。
项目文件上传不改变此内容版本号，但会更新最近编辑者与修改时间。

错误统一为 `{"message":"可展示的错误说明"}`：400 参数错误、401 未登录/凭据错误、403 跨站请求/CSRF/共创者权限错误、404 项目不存在、409 用户名重复或项目版本冲突、500 内部错误。
不会返回密码摘要、会话摘要或数据库错误细节。

## 评论

以下接口都需要 Session Cookie；POST 写操作还需要 X-CSRF-Token。全员可以发表和查看评论，评论及回复不提供删除接口。

| 方法与路径 | 参数 | 响应 |
| --- | --- | --- |
| GET /api/v1/projects/:id/comments | 项目 ID | items: Comment[] |
| POST /api/v1/projects/:id/comments | content（最多 2000 字） | Comment |
| POST /api/v1/comments/:id/replies | 评论 ID、content（最多 2000 字） | Reply |

Comment 包含 id、projectId、userId、user、content、createdAt、updatedAt、replies。Reply 与 Comment 类似但没有 replies。
评论列表按创建时间倒序排列；回复按创建时间升序排列。
回复只允许挂在一级评论下，不支持嵌套回复。当前不支持编辑或删除评论及回复；删除项目时，所属评论和提醒会随项目级联清理。
评论及回复不会更新项目的 `updatedAt`、`lastEditor` 或内容版本号。

评论和回复正文中的 `@用户名` 会为已注册用户创建站内提醒。用户名匹配不区分大小写并按规范化后的用户名去重；未知用户名、重复提及和提及发送者自己会被忽略。中文用户名后应使用空格或标点分隔正文。

## 站内提醒

以下接口需要 Session Cookie，标记已读还需要 X-CSRF-Token。

| 方法与路径 | 说明 | 返回 |
| --- | --- | --- |
| GET /api/v1/notifications | 最近 50 条提及提醒，按时间倒序 | items、unread |
| POST /api/v1/notifications/read | 将当前用户的全部提醒标记为已读 | message |

提醒包含发送者、项目、评论或回复编号、正文、已读状态和创建时间。删除对应评论、项目或用户时提醒随外键级联删除。

## 编辑历史

以下接口需要 Session Cookie。

| 方法与路径 | 参数 | 响应 |
| --- | --- | --- |
| GET /api/v1/projects/:id/history | page，默认 1，每页 20 条 | items、total |

历史记录按版本从新到旧排列，包含版本号、编辑者、操作类型、变化字段和时间。项目创建和内容编辑会写入不可变快照；迁移前已有项目会生成 baseline 记录。历史仅供查看，不提供版本恢复接口。旧数据库中已经存在的恢复记录仍会按原操作类型返回。文件上传和评论不进入内容编辑历史。

## 内部聊天

所有接口需要登录会话；写入请求需要 `X-CSRF-Token`。全员群对所有有效员工可用；私聊仅双方可访问；项目群仅作者、当前共创者和超级管理员可访问。超级管理员不能访问其他人的私聊。项目群成员重新加入后只能读取本次加入后的消息和文件。项目删除时会级联删除项目群及消息，文件正文进入清理队列。

| 方法与路径 | 用途 |
| --- | --- |
| GET /api/v1/chat/conversations | 可访问会话列表、未读数及未读提及数 |
| POST /api/v1/chat/direct | 以 `userId` 创建或打开一对一会话 |
| GET /api/v1/chat/conversations/:id/messages | 消息列表；支持 `before`、`q` 和 `files=true`，每次最多 100 条 |
| GET /api/v1/chat/conversations/:id/members | 会话成员搜索，支持 `q` |
| POST /api/v1/chat/conversations/:id/messages | 发送 `content`，可选 `replyTo`；正文最多 2000 字 |
| POST /api/v1/chat/conversations/:id/read | `lastMessageId` 标记已读至客户端实际收到的消息 |
| POST /api/v1/chat/messages/:id/recall | 本人随时撤回，正文和附件不可再查看 |
| GET /api/v1/chat/events | 同源 WebSocket；只推送不含正文的变更信号 |
| POST/HEAD/PATCH /api/v1/chat/uploads | tus 创建、查询和续传；上传者与会话权限均须通过校验 |
| POST /api/v1/chat/uploads/:id/complete | 完成上传并创建附件消息，重复完成保持幂等 |
| GET /api/v1/chat/files/:id/download | 下载附件，支持 Range |
| GET /api/v1/chat/files/:id/preview | 预览白名单类型，支持 Range |
| GET /api/v1/chat/conversations/:id/download-folder | 按 `batch` 和 `folder` 流式打包同批次文件夹 |

tus 元数据包括 `conversationId`、`filename`、可选 `relativePath`、`batchId` 和 `batchTotal`，每批最多 10000 个文件。批次未接收完整时，界面注明已接收数量，下载仅包含已接收的文件。文件上限为 5,000,000,000 字节。下载和预览每次都检查当前会话权限、成员加入时间、撤回状态及保留期限。消息和文件保留一个自然月；后台定期删除过期消息并将文件正文加入持久化清理队列，未完成上传在七天后清理。备份文件本身的保留期限由备份策略另行管理。

`@用户名` 只提醒该会话的有效成员，自己和非成员不会收到提及提醒。消息和附件会在提交成功后发送不含私人内容的 WebSocket 更新信号。WebSocket 需要与配置的 `ALLOWED_ORIGIN` 完全一致，并在断线后重新连接。

发送示例（`replyTo` 为 0 或省略表示普通消息）：

```json
{"content":"请 @xiaoli 查看资料","replyTo":0}
```

已读示例：

```json
{"lastMessageId":123}
```

无效消息或上传参数返回 400；未登录返回 401；会话或文件不存在、无权访问或引用不可见消息返回 404；上传未完成返回 409；超出大小上限返回 413；存储异常返回 5xx。tus 传输错误遵循 tus 响应格式，普通接口使用 `message` 错误正文。

## 管理员与项目删除

`User` 包含 `isAdmin`。`PUT /api/v1/users/:id/admin` 仅管理员可调用；系统拒绝撤销最后一名管理员或超级管理员的权限并返回 409。由 `BOOTSTRAP_ADMIN_USERNAME` 指定且仍具管理员权限的账号是唯一超级管理员；`AuthResponse.isSuperAdmin` 用于前端展示专属操作。

`DELETE /api/v1/users/:id` 仅超级管理员可调用，普通管理员没有此权限。删除采用账号软删除：立即撤销全部会话、禁止再次登录、从员工搜索和共创者选择中隐藏，并释放原用户名；项目、文件、评论及编辑历史继续保留，相关位置显示“已删除用户”。超级管理员不能删除自己。

`DELETE /api/v1/projects/:id` 仅项目作者或管理员可调用。删除会级联移除评论、历史和附件记录，附件正文进入持久化清理队列异步删除并在失败后重试。

## 项目文件

全部接口需 Session Cookie；写入需 X-CSRF-Token。

| 方法与路径 | 用途 |
| --- | --- |
| POST /api/v1/uploads | tus 创建上传；Upload-Length 和 Upload-Metadata 必填 |
| HEAD /api/v1/uploads/:id | 查询 Upload-Offset，仅原上传者可用 |
| PATCH /api/v1/uploads/:id | 按 Upload-Offset 续传，application/offset+octet-stream |
| POST /api/v1/uploads/:id/complete | 完成上传登记，返回 FileItem |
| DELETE /api/v1/files/:id | 删除项目文件或演示材料；所有登录员工可用 |
| GET /api/v1/projects/:id/files | 返回 items 附件列表 |
| GET /api/v1/projects/:id/files/download-all | 将当前项目文件流式打包为 ZIP 下载 |
| GET /api/v1/projects/:id/files/download-folder?folder=相对目录 | 将指定文件夹及其全部子目录流式打包为 ZIP 下载 |
| GET /api/v1/projects/:id/demo-files | 返回启用项目的演示材料列表 |
| GET /api/v1/files/:id/download | 普通项目文件原格式下载，支持 Range；演示材料不可下载 |
| GET /api/v1/files/:id/preview | 内嵌预览演示材料，支持 Range |

Upload-Metadata 按 tus 规范使用 Base64，字段 filename、projectId、kind（`project` 或 `demo`，缺省为 `project`）和可选 relativePath。relativePath 使用 `/` 分隔且不包含文件名；绝对路径、反斜杠、空路径段及 `.`/`..` 路径段会被拒绝。项目必须先启用 `demoEnabled` 才能创建并完成演示材料上传。旧客户端提交非零 `replaceId` 会返回 400。

文件夹下载的 `folder` 使用与 relativePath 相同的安全相对路径格式。ZIP 只包含所选文件夹中的正式项目文件，并以所选文件夹作为压缩包内的根目录；待保存文件和演示材料不会进入压缩包。

Web 前端在编辑页选择文件后先加入待保存列表，不立即上传；现有文件删除也只标记为待删除。用户点击顶部“保存修改”后，才按顺序启动 tus 上传并执行删除；保存前其他用户仍看到原文件状态。
FileItem 包含 id、filename、relativePath、size、uploader、updatedAt、kind、previewable。普通项目文件和演示材料分别列出。
文件上限 5,000,000,000 字节，超过返回 413；零字节文件允许保存。
上传未完成不显示在附件列表，也不能通过正式下载接口访问；完成登记后才对其他员工可见。
错误偏移或未完整上传返回 409，另一员工访问临时上传返回 403。完成接口重复调用幂等。
上传传输错误采用 tus 标准错误正文；业务 JSON 错误采用 message 格式。

所有登录员工都可以删除已登记文件。删除事务先移除附件记录，再将正文加入持久化清理队列；清理失败会继续重试。删除文件会更新项目最近编辑者与修改时间，但不增加内容版本号。

批量下载只包含普通项目文件，不包含演示材料；使用 ZIP Store 流式输出，不在服务端生成临时压缩包，也不会把文件整体载入内存。ZIP 保留上传时的相对目录，目录内同名文件会自动追加序号；项目没有文件时返回 404。

预览只接受扩展名白名单：`.jpg`、`.jpeg`、`.png`、`.gif`、`.webp`、`.pdf`、`.mp4`；其他演示材料仅保留文件信息，预览接口返回 415。所有演示材料均不可通过下载接口获取。预览响应使用固定媒体类型、`nosniff`、CSP sandbox、同源资源策略和 `inline` disposition，不直接采用上传者提供的 MIME 类型。
