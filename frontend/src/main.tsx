import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, errorMessage, type Session, type Project } from "./api";
import { Auth } from "./Auth";
import { ProjectForm, categories } from "./ProjectForm";
import "./style.css";
import { FilesPanel, type SelectedFile } from "./FilesPanel";
import { ProjectEdit } from "./ProjectEdit";
import { CommentsPanel } from "./CommentsPanel";
import { ProjectHistory } from "./ProjectHistory";
import { AdminPanel } from "./AdminPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { PasswordPanel } from "./PasswordPanel";
import { ChatPanel } from "./ChatPanel";
import { createCompatibleAbortController } from "./browserCompat";
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
function Detail({
  project,
  back,
  session,
  edit,
  onExpired,
  onDeleted,
  targetCommentId,
  onCommentTargetHandled,
  onOpenChat,
}: {
  project: Project;
  back: () => void;
  session: Session;
  edit: (project: Project) => void;
  onExpired: () => void;
  onDeleted: () => void;
  targetCommentId: number | null;
  onCommentTargetHandled: () => void;
  onOpenChat: (projectId: number) => void;
}) {
  const p = project;
  const [refreshError, setRefreshError] = useState("");
  const [deleting, setDeleting] = useState(false);
  async function deleteProject() {
    const typed = window.prompt(
      `删除后项目记录、评论、历史和附件都会移除。请输入项目名称“${p.name}”确认删除：`,
    );
    if (typed !== p.name) return;
    setDeleting(true);
    setRefreshError("");
    try {
      await api(`/projects/${p.id}`, { method: "DELETE" }, session.csrfToken);
      onDeleted();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setRefreshError(errorMessage(reason));
    } finally {
      setDeleting(false);
    }
  }
  function goToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }
  return (
    <>
      <button className="text-button back-button" onClick={back}>
        返回项目列表
      </button>
      <div className="page-title detail-title">
        <div className="detail-title-copy">
          <div className="title-line">
            <h1>{p.name}</h1>
            <span className="category">{p.category}</span>
          </div>
          <p>{p.summary || "暂无简介"}</p>
        </div>
        <div className="detail-actions">
          {(session.isSuperAdmin ||
            session.user.id === p.author.id ||
            p.collaborators.some((user) => user.id === session.user.id)) && (
            <button type="button" onClick={() => onOpenChat(p.id)}>
              项目群聊
            </button>
          )}
          {(session.user.id === p.author.id || session.user.isAdmin) && (
            <button
              className="danger-button"
              onClick={() => void deleteProject()}
              disabled={deleting}
            >
              {deleting ? "正在删除…" : "删除项目"}
            </button>
          )}
          <button className="primary" onClick={() => edit(p)}>
            编辑项目
          </button>
        </div>
      </div>
      <dl className="metadata">
        <div>
          <dt>作者</dt>
          <dd>{p.author.name}</dd>
        </div>
        <div>
          <dt>共创者</dt>
          <dd>{p.collaborators.map((u) => u.name).join("、") || "暂无"}</dd>
        </div>
        <div>
          <dt>发布时间</dt>
          <dd>{date(p.createdAt)}</dd>
        </div>
        <div>
          <dt>最近修改</dt>
          <dd>
            {p.lastEditor.name}
            <br />
            {date(p.updatedAt)}
          </dd>
        </div>
      </dl>
      <nav className="detail-navigation" aria-label="项目内容导航">
        <button type="button" onClick={() => goToSection("project-readme")}>
          项目说明
        </button>
        {p.demoEnabled && (
          <button type="button" onClick={() => goToSection("project-demo")}>
            演示材料
          </button>
        )}
        <button type="button" onClick={() => goToSection("project-files")}>
          项目文件
        </button>
        <button type="button" onClick={() => goToSection("project-comments")}>
          评论
        </button>
        <button type="button" onClick={() => goToSection("project-history")}>
          编辑历史
        </button>
      </nav>
      <section id="project-readme" className="readme-panel detail-anchor">
        <h2>项目说明</h2>
        <article className="markdown">
          <Markdown remarkPlugins={[remarkGfm]}>
            {p.readme || "暂无项目说明。"}
          </Markdown>
        </article>
      </section>
      {p.demoEnabled && (
        <div id="project-demo" className="detail-anchor">
          <FilesPanel
            key={`${p.id}-demo`}
            projectId={p.id}
            session={session}
            kind="demo"
          />
        </div>
      )}
      <div id="project-files" className="detail-anchor">
        <FilesPanel key={p.id} projectId={p.id} session={session} />
      </div>
      <div id="project-comments" className="detail-anchor">
        <CommentsPanel
          projectId={p.id}
          session={session}
          onExpired={onExpired}
          targetCommentId={targetCommentId}
          onTargetHandled={onCommentTargetHandled}
        />
      </div>
      <div id="project-history" className="detail-anchor">
        <ProjectHistory project={p} onExpired={onExpired} />
      </div>
      {refreshError && (
        <p role="alert" className="error">
          {refreshError}
        </p>
      )}
    </>
  );
}
function Workspace({
  session,
  onExpired,
}: {
  session: Session;
  onExpired: () => void;
}) {
  const [scope, setScope] = useState("all"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [sort, setSort] = useState("updated"),
    [page, setPage] = useState(1);
  const [view, setView] = useState<
      | "list"
      | "create"
      | "detail"
      | "edit"
      | "admin"
      | "notifications"
      | "chat"
      | "password"
    >("list"),
    [detail, setDetail] = useState<Project | null>(null),
    [items, setItems] = useState<Project[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [initialFiles, setInitialFiles] = useState<SelectedFile[]>([]);
  const [initialDemoFiles, setInitialDemoFiles] = useState<SelectedFile[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [targetCommentId, setTargetCommentId] = useState<number | null>(null);
  const [chatRevision, setChatRevision] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatUploading, setChatUploading] = useState(false);
  const [chatVisited, setChatVisited] = useState(false);
  const [chatProjectTarget, setChatProjectTarget] = useState<number | null>(
    null,
  );
  const refreshChat = useCallback(
    () => setChatRevision((value) => value + 1),
    [],
  );
  const refreshChatUnread = useCallback(() => {
    void api<{ items: { unread: number }[] }>("/chat/conversations")
      .then((result) =>
        setChatUnread(result.items.reduce((sum, item) => sum + item.unread, 0)),
      )
      .catch(() => {
        /* Retry on the next event or reconnect. */
      });
  }, []);
  useEffect(() => {
    let cancelled = false;
    api<{ items: { unread: number }[] }>("/chat/conversations")
      .then((result) => {
        if (!cancelled)
          setChatUnread(
            result.items.reduce((sum, item) => sum + item.unread, 0),
          );
      })
      .catch(() => {
        /* Chat may be unavailable while a deployment is updating. */
      });
    return () => {
      cancelled = true;
    };
  }, [chatRevision]);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let pendingRefresh: number | undefined;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/chat/events`,
      );
      socket.onopen = refreshChat;
      socket.onmessage = () => {
        if (pendingRefresh !== undefined) return;
        pendingRefresh = window.setTimeout(() => {
          pendingRefresh = undefined;
          refreshChat();
        }, 200);
      };
      socket.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 5000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      if (pendingRefresh !== undefined) window.clearTimeout(pendingRefresh);
      socket?.close();
    };
  }, [refreshChat]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const result = await api<{ unread: number }>("/notifications");
        if (!stopped) setUnreadNotifications(result.unread);
      } catch (reason) {
        if (!stopped && reason instanceof ApiError && reason.status === 401)
          onExpired();
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [onExpired]);
  useEffect(() => {
    if (view !== "list") return;
    const c = createCompatibleAbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      scope,
      q: search,
      category,
      sort,
      page: String(page),
    });
    api<{ items: Project[]; total: number }>("/projects?" + params, {
      signal: c.signal,
    })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!c.signal?.aborted) {
          if (e instanceof ApiError && e.status === 401) onExpired();
          else setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (!c.signal?.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [scope, search, category, sort, page, revision, view]);
  async function logout() {
    if (
      chatUploading &&
      !window.confirm("聊天文件正在上传，退出登录会中断上传，确定退出吗？")
    )
      return;
    try {
      await api("/auth/logout", { method: "POST" }, session.csrfToken);
      onExpired();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired();
      else setError(errorMessage(e));
    }
  }
  async function openProject(id: number, commentId: number | null = null) {
    setInitialFiles([]);
    setInitialDemoFiles([]);
    setTargetCommentId(commentId);
    setError("");
    try {
      setDetail(await api<Project>("/projects/" + id));
      setView("detail");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired();
      else setError(errorMessage(e));
    }
  }
  function navigate(next: string) {
    setScope(next);
    setView("list");
    setPage(1);
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          数字资产
          <br />
          <strong>管理中心</strong>
        </div>
        <nav aria-label="主导航">
          <button
            aria-current={
              scope === "all" && view === "list" ? "page" : undefined
            }
            onClick={() => navigate("all")}
          >
            项目广场
          </button>
          {session.user.isAdmin && (
            <button
              aria-current={view === "admin" ? "page" : undefined}
              onClick={() => setView("admin")}
            >
              员工权限
            </button>
          )}
          <button
            aria-current={
              scope === "mine" && view === "list" ? "page" : undefined
            }
            onClick={() => navigate("mine")}
          >
            我的项目
          </button>
          <button
            className="nav-notification"
            aria-current={view === "chat" ? "page" : undefined}
            onClick={() => {
              setChatVisited(true);
              setView("chat");
            }}
          >
            <span>消息</span>
            {chatUnread > 0 && (
              <span
                className="notification-count"
                aria-label={`${chatUnread} 条未读消息`}
              >
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
            )}
          </button>
          <button
            className="nav-notification"
            aria-current={view === "notifications" ? "page" : undefined}
            onClick={() => setView("notifications")}
          >
            <span>提醒</span>
            {unreadNotifications > 0 && (
              <span
                className="notification-count"
                aria-label={`${unreadNotifications} 条未读提醒`}
              >
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </button>
        </nav>
        <div className="account">
          <strong>{session.user.name}</strong>
          <span>@{session.user.username}</span>
          <button className="text-button" onClick={() => void logout()}>
            退出登录
          </button>
          <button className="text-button" onClick={() => setView("password")}>
            修改密码
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header>
          <span>团队工作空间</span>
          <span>内网共享</span>
        </header>
        <main className={`content content-${view}`}>
          {view === "admin" ? (
            <AdminPanel
              session={session}
              onExpired={onExpired}
              onChangeOwnPassword={() => setView("password")}
            />
          ) : view === "password" ? (
            <PasswordPanel
              session={session}
              onExpired={onExpired}
              onChanged={() => setView("list")}
              onCancel={() => setView("list")}
            />
          ) : view === "chat" ? null : view === "notifications" ? (
            <NotificationsPanel
              session={session}
              onExpired={onExpired}
              onUnreadChange={setUnreadNotifications}
              onOpenProject={(projectId, commentId) =>
                void openProject(projectId, commentId)
              }
            />
          ) : view === "create" ? (
            <ProjectForm
              session={session}
              onExpired={onExpired}
              onCancel={() => setView("list")}
              onCreated={(p, files, demoFiles) => {
                setInitialFiles(files);
                setInitialDemoFiles(demoFiles);
                setDetail(p);
                setView(files.length || demoFiles.length ? "edit" : "detail");
                setRevision((v) => v + 1);
              }}
            />
          ) : view === "edit" && detail ? (
            <ProjectEdit
              key={detail.id}
              initialProject={detail}
              session={session}
              initialFiles={initialFiles}
              initialDemoFiles={initialDemoFiles}
              onExpired={onExpired}
              onProjectChanged={(project) => {
                setDetail(project);
                setRevision((value) => value + 1);
              }}
              onCancel={() => {
                setInitialFiles([]);
                setInitialDemoFiles([]);
                setView("detail");
              }}
              onSaved={(project) => {
                setInitialFiles([]);
                setInitialDemoFiles([]);
                setDetail(project);
                setView("detail");
                setRevision((value) => value + 1);
              }}
            />
          ) : view === "detail" && detail ? (
            <Detail
              project={detail}
              session={session}
              onExpired={onExpired}
              targetCommentId={targetCommentId}
              onCommentTargetHandled={() => setTargetCommentId(null)}
              onOpenChat={(projectId) => {
                setChatProjectTarget(projectId);
                setChatVisited(true);
                setView("chat");
              }}
              onDeleted={() => {
                setDetail(null);
                setTargetCommentId(null);
                setView("list");
                setRevision((value) => value + 1);
              }}
              back={() => {
                setTargetCommentId(null);
                setView("list");
              }}
              edit={(project) => {
                setInitialFiles([]);
                setInitialDemoFiles([]);
                setTargetCommentId(null);
                setDetail(project);
                setView("edit");
              }}
            />
          ) : (
            <>
              <div className="page-title">
                <div className="page-title-copy">
                  <h1>{scope === "all" ? "项目广场" : "我的项目"}</h1>
                  <p>
                    {scope === "all"
                      ? "查找团队已经沉淀的项目、文档与交付成果。"
                      : "集中查看你创建和参与共创的项目。"}
                  </p>
                </div>
                <div className="page-title-actions">
                  {!loading && !error && (
                    <span className="project-total">
                      <strong>{total}</strong>
                      <span>个项目</span>
                    </span>
                  )}
                  <button className="primary" onClick={() => setView("create")}>
                    创建项目
                  </button>
                </div>
              </div>
              <div className="toolbar">
                <form
                  className="search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(query);
                    setPage(1);
                  }}
                >
                  <input
                    aria-label="搜索项目"
                    placeholder="搜索项目名称、简介"
                    value={query}
                    maxLength={200}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button>搜索</button>
                </form>
                <select
                  aria-label="项目分类"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部分类</option>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select
                  aria-label="排序方式"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="updated">最近修改</option>
                  <option value="created">最近发布</option>
                </select>
              </div>
              {error ? (
                <div role="alert" className="notice error">
                  {error}
                  <button onClick={() => setRevision((v) => v + 1)}>
                    重试
                  </button>
                </div>
              ) : loading ? (
                <p role="status" className="empty">
                  正在加载项目…
                </p>
              ) : items.length ? (
                <>
                  <section className="project-directory" aria-label="项目列表">
                    <div className="directory-heading" aria-hidden="true">
                      <span>项目</span>
                      <span>负责人</span>
                      <span>项目动态</span>
                    </div>
                    <div className="directory-list">
                      {items.map((p) => (
                        <article className="project-row" key={p.id}>
                          <div className="project-identity">
                            <div className="project-name-row">
                              <button
                                className="project-link"
                                onClick={() => void openProject(p.id)}
                              >
                                {p.name}
                              </button>
                              <span className="category">{p.category}</span>
                            </div>
                            <p>{p.summary || "暂无项目简介"}</p>
                          </div>
                          <div className="project-people">
                            <div>
                              <strong>{p.author.name}</strong>
                              <span>
                                {p.collaborators.length
                                  ? `与 ${p.collaborators
                                      .map((u) => u.name)
                                      .join("、")} 共创`
                                  : "独立项目"}
                              </span>
                            </div>
                          </div>
                          <div className="project-activity">
                            <div className="activity-primary">
                              <span>最近修改</span>
                              <time dateTime={p.updatedAt}>
                                {date(p.updatedAt)}
                              </time>
                              <small>{p.lastEditor.name} 编辑</small>
                            </div>
                            <div className="activity-created">
                              <span>发布于</span>
                              <time dateTime={p.createdAt}>
                                {date(p.createdAt)}
                              </time>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                  <div className="pagination">
                    <span>共 {total} 个项目</span>
                    <div>
                      <button
                        disabled={page === 1}
                        onClick={() => setPage((v) => v - 1)}
                      >
                        上一页
                      </button>
                      <span>第 {page} 页</span>
                      <button
                        disabled={page * 20 >= total}
                        onClick={() => setPage((v) => v + 1)}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty">
                  <h2>
                    {search || category
                      ? "没有找到匹配的项目"
                      : "这里还没有项目"}
                  </h2>
                  <p>
                    {search || category
                      ? "试试其他关键词，或清除筛选条件。"
                      : "发布第一份项目成果，让同事了解你的工作。"}
                  </p>
                  {search || category ? (
                    <button
                      onClick={() => {
                        setQuery("");
                        setSearch("");
                        setCategory("");
                        setPage(1);
                      }}
                    >
                      清除筛选
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => setView("create")}
                    >
                      创建项目
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {chatVisited && (
            <div hidden={view !== "chat"}>
              <ChatPanel
                session={session}
                onExpired={onExpired}
                revision={chatRevision}
                onRefresh={refreshChat}
                onRead={refreshChatUnread}
                visible={view === "chat"}
                targetProjectId={chatProjectTarget}
                onProjectTargetHandled={() => setChatProjectTarget(null)}
                onUploadingChange={setChatUploading}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function restore() {
    setLoading(true);
    setError("");
    try {
      setSession(await api<Session>("/auth/me"));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  if (loading)
    return (
      <div className="boot" role="status">
        正在打开工作空间…
      </div>
    );
  if (error)
    return (
      <div className="boot">
        <h1>暂时无法连接工作空间</h1>
        <p role="alert">{error}</p>
        <button onClick={() => void restore()}>重新连接</button>
      </div>
    );
  return session?.mustChangePassword ? (
    <PasswordPanel
      session={session}
      required
      onExpired={() => setSession(null)}
      onChanged={setSession}
    />
  ) : session ? (
    <Workspace session={session} onExpired={() => setSession(null)} />
  ) : (
    <Auth onLogin={setSession} />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
