import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { DetailedError, Upload } from "tus-js-client";
import {
  api,
  ApiError,
  errorMessage,
  type ChatConversation,
  type ChatMessage,
  type Session,
  type User,
} from "./api";
import {
  filesFromDrop,
  filesFromList,
  MAX_FILE_SIZE,
  type SelectedFile,
} from "./FilesPanel";
import { createTaskKey, digestUploadSample } from "./browserCrypto";
import { readBlobAsArrayBuffer } from "./browserCompat";
import "./chat.css";

type UploadTask = SelectedFile & {
  key: string;
  conversationId: number;
  batchId: string;
  batchTotal: number;
  progress: number;
  status: "queued" | "uploading" | "finishing" | "error";
  error?: string;
};

function MessageText({ content }: { content: string }) {
  return content.split(/(@[\p{L}\p{N}._-]{2,32})/gu).map((part, index) =>
    part.startsWith("@") ? (
      <span className="chat-mention" key={index}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function ChatPanel({
  session,
  onExpired,
  revision,
  onRefresh,
  onRead,
  visible,
  targetProjectId,
  onProjectTargetHandled,
  onUploadingChange,
}: {
  session: Session;
  onExpired: () => void;
  revision: number;
  onRefresh: () => void;
  onRead: () => void;
  visible: boolean;
  targetProjectId: number | null;
  onProjectTargetHandled: () => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [replyTargets, setReplyTargets] = useState<
    Record<number, ChatMessage | undefined>
  >({});
  const [query, setQuery] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filesOnly, setFilesOnly] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [mention, setMention] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [mentionUsers, setMentionUsers] = useState<User[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const uploadRefs = useRef(new Map<string, Upload>());
  const messageEnd = useRef<HTMLDivElement>(null);
  const activeRef = useRef<number | null>(null);
  const messageRequest = useRef(0);
  const conversationRequest = useRef(0);
  const skipAutoScroll = useRef(false);
  const alive = useRef(true);
  const active = conversations.find((item) => item.id === activeId);

  const handleError = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    },
    [onExpired],
  );
  const loadConversations = useCallback(async () => {
    const requestId = ++conversationRequest.current;
    try {
      const result = await api<{ items: ChatConversation[] }>(
        "/chat/conversations",
      );
      if (requestId !== conversationRequest.current) return;
      setConversations(result.items);
      const allowed = new Set(result.items.map((item) => item.id));
      setReplyTargets((current) => {
        const next = { ...current };
        for (const id of Object.keys(next))
          if (!allowed.has(Number(id))) delete next[Number(id)];
        return next;
      });
      setActiveId((id) =>
        result.items.some((item) => item.id === id)
          ? id
          : (result.items[0]?.id ?? null),
      );
    } catch (reason) {
      handleError(reason);
    }
  }, [handleError]);
  const loadMessages = useCallback(
    async (id: number) => {
      const requestId = ++messageRequest.current;
      try {
        const params = new URLSearchParams();
        if (appliedSearch) params.set("q", appliedSearch);
        if (filesOnly) params.set("files", "true");
        const result = await api<{ items: ChatMessage[] }>(
          `/chat/conversations/${id}/messages?${params}`,
        );
        if (activeRef.current !== id || requestId !== messageRequest.current)
          return;
        setMessages(result.items);
        setReplyTargets((current) =>
          current[id] &&
          !result.items.some(
            (item) => item.id === current[id]?.id && !item.recalled,
          )
            ? { ...current, [id]: undefined }
            : current,
        );
        setHasOlder(result.items.length === 100);
        if (!appliedSearch && !filesOnly) {
          await api(
            `/chat/conversations/${id}/read`,
            {
              method: "POST",
              body: JSON.stringify({
                lastMessageId: result.items[result.items.length - 1]?.id ?? 0,
              }),
            },
            session.csrfToken,
          );
          void loadConversations();
          onRead();
        }
      } catch (reason) {
        if (activeRef.current === id) handleError(reason);
      }
    },
    [
      handleError,
      loadConversations,
      onRead,
      session.csrfToken,
      appliedSearch,
      filesOnly,
    ],
  );

  async function loadOlder() {
    if (!activeId || !messages.length || loadingOlder) return;
    const id = activeId;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ before: String(messages[0].id) });
      if (appliedSearch) params.set("q", appliedSearch);
      if (filesOnly) params.set("files", "true");
      const result = await api<{ items: ChatMessage[] }>(
        `/chat/conversations/${id}/messages?${params}`,
      );
      if (activeRef.current !== id) return;
      skipAutoScroll.current = true;
      setMessages((current) => [...result.items, ...current]);
      setHasOlder(result.items.length === 100);
    } catch (reason) {
      if (activeRef.current === id) handleError(reason);
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, [loadConversations, revision]);
  useEffect(() => {
    if (!visible || !targetProjectId) return;
    const target = conversations.find(
      (item) => item.kind === "project" && item.projectId === targetProjectId,
    );
    if (!target) return;
    setActiveId(target.id);
    onProjectTargetHandled();
  }, [visible, targetProjectId, conversations, onProjectTargetHandled]);
  useEffect(() => {
    activeRef.current = visible ? activeId : null;
    setMention(null);
    setMentionUsers([]);
    setMessages([]);
    if (visible && activeId) void loadMessages(activeId);
  }, [activeId, loadMessages, visible]);
  useEffect(() => {
    setMessageSearch("");
    setAppliedSearch("");
    setFilesOnly(false);
  }, [activeId]);
  useEffect(() => {
    if (visible && activeId) void loadMessages(activeId);
  }, [revision, visible]);
  useEffect(() => {
    onUploadingChange(uploads.some((task) => task.status !== "error"));
    if (!uploads.some((task) => task.status !== "error")) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploads, onUploadingChange]);
  useEffect(() => {
    if (!visible) return;
    if (!query.trim()) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<{ items: User[] }>("/users?q=" + encodeURIComponent(query.trim()))
        .then((result) => {
          if (!cancelled)
            setUsers(
              result.items.filter((user) => user.id !== session.user.id),
            );
        })
        .catch((reason) => {
          if (!cancelled) handleError(reason);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, session.user.id, handleError, visible]);
  useEffect(() => {
    if (!visible || !activeId || !mention) {
      setMentionUsers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<{ items: User[] }>(
        `/chat/conversations/${activeId}/members?q=${encodeURIComponent(mention.query)}`,
      )
        .then((result) => {
          if (!cancelled) {
            setMentionUsers(
              result.items
                .filter((user) => user.id !== session.user.id)
                .slice(0, 8),
            );
            setMentionIndex(0);
          }
        })
        .catch((reason) => {
          if (!cancelled) handleError(reason);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeId, mention?.query, visible, session.user.id, handleError]);

  function updateMention(value: string, cursor: number) {
    const match = value
      .slice(0, cursor)
      .match(/(?:^|[^A-Za-z0-9._-])@([\p{L}\p{N}._-]{0,32})$/u);
    if (!match || match[1] !== mention?.query) setMentionUsers([]);
    setMention(
      match
        ? { start: cursor - match[1].length - 1, end: cursor, query: match[1] }
        : null,
    );
  }
  function chooseMention(user: User) {
    if (!activeId || !mention) return;
    const value = drafts[activeId] ?? "";
    const inserted = `@${user.username} `;
    const next =
      value.slice(0, mention.start) + inserted + value.slice(mention.end);
    const cursor = mention.start + inserted.length;
    setDrafts((current) => ({ ...current, [activeId]: next }));
    setMention(null);
    requestAnimationFrame(() => {
      messageInput.current?.focus();
      messageInput.current?.setSelectionRange(cursor, cursor);
    });
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const upload of uploadRefs.current.values()) void upload.abort();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    if (skipAutoScroll.current) {
      skipAutoScroll.current = false;
      return;
    }
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [activeId, messages.length, visible]);

  async function openDirect(user: User) {
    try {
      const item = await api<ChatConversation>(
        "/chat/direct",
        { method: "POST", body: JSON.stringify({ userId: user.id }) },
        session.csrfToken,
      );
      conversationRequest.current += 1;
      setConversations((current) => [
        item,
        ...current.filter((entry) => entry.id !== item.id),
      ]);
      setQuery("");
      setUsers([]);
      setActiveId(item.id);
      onRefresh();
    } catch (reason) {
      handleError(reason);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId || sending) return;
    const content = (drafts[activeId] ?? "").trim();
    if (!content) return;
    setSending(true);
    setError("");
    try {
      await api(
        `/chat/conversations/${activeId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content,
            replyTo: replyTargets[activeId]?.id ?? 0,
          }),
        },
        session.csrfToken,
      );
      setDrafts((current) => ({ ...current, [activeId]: "" }));
      setMention(null);
      setReplyTargets((current) => ({ ...current, [activeId]: undefined }));
      setMessageSearch("");
      setAppliedSearch("");
      setFilesOnly(false);
      await loadMessages(activeId);
    } catch (reason) {
      handleError(reason);
    } finally {
      setSending(false);
    }
  }
  async function recall(message: ChatMessage) {
    if (!window.confirm("撤回后消息内容和附件将不可查看，确定撤回吗？")) return;
    try {
      await api(
        `/chat/messages/${message.id}/recall`,
        { method: "POST" },
        session.csrfToken,
      );
      await loadMessages(message.conversationId);
    } catch (reason) {
      handleError(reason);
    }
  }
  function updateTask(key: string, patch: Partial<UploadTask>) {
    setUploads((items) =>
      items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }
  function startUpload(task: UploadTask) {
    if (uploadRefs.current.has(task.key)) return;
    updateTask(task.key, { status: "uploading", error: "" });
    async function clearStaleUpload() {
      try {
        for (const entry of await upload.findPreviousUploads()) {
          if (entry.uploadUrl === upload.url)
            await upload.options.urlStorage?.removeUpload(entry.urlStorageKey);
        }
      } catch {
        /* A missing local resume entry does not affect the file. */
      }
    }
    const upload = new Upload(task.file, {
      endpoint: "/api/v1/chat/uploads",
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: false,
      metadata: {
        filename: task.file.name,
        conversationId: String(task.conversationId),
        relativePath: task.relativePath,
        batchId: task.batchId,
        batchTotal: String(task.batchTotal),
      },
      headers: { "X-CSRF-Token": session.csrfToken },
      fingerprint: async (raw) => {
        const file = raw as File;
        const sample = await readBlobAsArrayBuffer(
          new Blob([
            file.slice(0, 65536),
            file.slice(Math.max(0, file.size - 65536)),
          ]),
        );
        return [
          "chat",
          location.origin,
          session.user.id,
          task.conversationId,
          task.relativePath,
          file.name,
          file.size,
          file.lastModified,
          await digestUploadSample(sample),
        ].join(":");
      },
      onProgress: (sent, total) =>
        updateTask(task.key, {
          progress: total ? Math.round((sent / total) * 100) : 100,
        }),
      onError: (reason) => {
        uploadRefs.current.delete(task.key);
        const status =
          reason instanceof DetailedError
            ? reason.originalResponse?.getStatus()
            : undefined;
        if (status === 404 || status === 410) void clearStaleUpload();
        updateTask(task.key, {
          status: "error",
          error: "上传失败，请检查网络和会话权限后重试。",
        });
      },
      onSuccess: async () => {
        updateTask(task.key, { status: "finishing", progress: 100 });
        try {
          const id = upload.url?.split("/").pop();
          if (!id) throw new Error("上传编号不存在，请重试。");
          await api(
            `/chat/uploads/${id}/complete`,
            { method: "POST" },
            session.csrfToken,
          );
          try {
            for (const entry of await upload.findPreviousUploads())
              if (entry.uploadUrl === upload.url)
                await upload.options.urlStorage?.removeUpload(
                  entry.urlStorageKey,
                );
          } catch {
            /* The uploaded file is already saved. */
          }
          uploadRefs.current.delete(task.key);
          setUploads((current) =>
            current.filter((item) => item.key !== task.key),
          );
          if (activeRef.current === task.conversationId)
            void loadMessages(task.conversationId);
        } catch (reason) {
          uploadRefs.current.delete(task.key);
          updateTask(task.key, {
            status: "error",
            error: errorMessage(reason),
          });
        }
      },
    });
    uploadRefs.current.set(task.key, upload);
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (!alive.current || uploadRefs.current.get(task.key) !== upload)
          return;
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch((reason) => {
        uploadRefs.current.delete(task.key);
        updateTask(task.key, { status: "error", error: errorMessage(reason) });
      });
  }
  function addFiles(files: SelectedFile[]) {
    if (!activeId) return;
    if (!files.length) {
      setError("没有找到可添加的文件，空文件夹不会上传。");
      return;
    }
    if (files.length > 10000) {
      setError("一次最多添加 10000 个文件，请分批上传。");
      return;
    }
    const invalid = files.find(({ file }) => file.size > MAX_FILE_SIZE);
    if (invalid) {
      setError(`${invalid.file.name} 超过单文件 5 GB 上限。`);
      return;
    }
    setError("");
    const batchId = createTaskKey();
    const tasks = files.map((item): UploadTask => ({
      ...item,
      key: createTaskKey(),
      conversationId: activeId,
      batchId,
      batchTotal: files.length,
      progress: 0,
      status: "queued",
    }));
    setUploads((current) => [...current, ...tasks]);
  }
  async function removeUpload(task: UploadTask) {
    const upload = uploadRefs.current.get(task.key);
    uploadRefs.current.delete(task.key);
    if (upload) {
      try {
        await upload.abort();
      } catch {
        uploadRefs.current.set(task.key, upload);
        setError("无法取消上传，请稍后重试。");
        return;
      }
    }
    setUploads((current) => current.filter((item) => item.key !== task.key));
  }
  useEffect(() => {
    let slots = Math.max(0, 3 - uploadRefs.current.size);
    for (const task of uploads) {
      if (!slots) break;
      if (task.status === "queued" && !uploadRefs.current.has(task.key)) {
        startUpload(task);
        slots -= 1;
      }
    }
  }, [uploads]);
  async function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    setReading(true);
    try {
      addFiles(await filesFromDrop(event.dataTransfer));
    } catch {
      setError("无法读取文件夹，请重试。");
    } finally {
      setReading(false);
    }
  }
  return (
    <div className="chat-page">
      <div className="page-title">
        <div>
          <h1>消息</h1>
          <p>与同事交流并传递工作资料</p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-layout">
        <aside className="chat-sidebar" aria-label="会话列表">
          <label htmlFor="chat-user-search">发起私聊</label>
          <input
            id="chat-user-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或用户名"
          />
          {query.trim() && (
            <div className="chat-user-results">
              {users.length ? (
                users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => void openDirect(user)}
                  >
                    <strong>{user.name}</strong>
                    <span>@{user.username}</span>
                  </button>
                ))
              ) : (
                <p className="hint">没有找到匹配的员工</p>
              )}
            </div>
          )}
          <div className="chat-list">
            {conversations.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === activeId ? "is-active" : ""}
                onClick={() => setActiveId(item.id)}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.mentions > 0
                      ? "有人提到我"
                      : item.kind === "project"
                        ? "项目群"
                        : item.kind === "global"
                          ? "全员群"
                          : "私聊"}
                  </small>
                </span>
                {item.unread > 0 && (
                  <span className="chat-unread">
                    {item.unread > 99 ? "99+" : item.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>
        {active ? (
          <section
            className={`chat-conversation${dragging ? " is-dragging" : ""}`}
            aria-label={`${active.name}聊天`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setDragging(false);
            }}
            onDrop={(event) => void drop(event)}
          >
            <div className="chat-conversation-heading">
              <strong>{active.name}</strong>
              <span>
                {active.kind === "project"
                  ? "项目群"
                  : active.kind === "global"
                    ? "全员群"
                    : "一对一私聊"}
              </span>
              <button
                type="button"
                className="text-button chat-files-toggle"
                onClick={() => setFilesOnly((value) => !value)}
              >
                {filesOnly ? "返回全部消息" : "聊天文件"}
              </button>
            </div>
            <form
              className="chat-search"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(messageSearch.trim());
              }}
            >
              <input
                aria-label="搜索聊天记录"
                value={messageSearch}
                maxLength={100}
                placeholder="搜索消息或文件名"
                onChange={(event) => setMessageSearch(event.target.value)}
              />
              <button type="submit">搜索</button>
              {(appliedSearch || filesOnly) && (
                <button
                  type="button"
                  onClick={() => {
                    setMessageSearch("");
                    setAppliedSearch("");
                    setFilesOnly(false);
                  }}
                >
                  清除
                </button>
              )}
            </form>
            <div className="chat-messages" aria-live="polite">
              {hasOlder && (
                <button
                  className="text-button chat-load-older"
                  type="button"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "正在加载…" : "加载更早消息"}
                </button>
              )}
              {!messages.length && (
                <p className="chat-empty">
                  {filesOnly || appliedSearch
                    ? "没有找到匹配的消息或文件。"
                    : "暂无消息，开始交流吧。"}
                </p>
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message${message.author.id === session.user.id ? " is-mine" : ""}`}
                >
                  <div className="chat-message-meta">
                    <strong>{message.author.name}</strong>
                    <time dateTime={message.createdAt}>
                      {new Date(message.createdAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </time>
                  </div>
                  {message.recalled ? (
                    <p className="chat-recalled">消息已撤回</p>
                  ) : (
                    <div className="chat-message-content">
                      {message.replyTo > 0 &&
                        (() => {
                          const target = messages.find(
                            (item) => item.id === message.replyTo,
                          );
                          return (
                            <blockquote className="chat-quoted">
                              {target
                                ? `${target.author.name}：${target.content || target.filename || "消息不可查看"}`
                                : "引用的消息不在当前列表中"}
                            </blockquote>
                          );
                        })()}
                      {message.content && (
                        <p>
                          <MessageText content={message.content} />
                        </p>
                      )}
                      {message.attachmentId && (
                        <div className="chat-attachment">
                          <strong>{message.filename}</strong>
                          <small>
                            {message.relativePath && `${message.relativePath}/`}
                            {(message.size / 1024 / 1024).toFixed(2)} MB
                          </small>
                          {message.batchTotal > 1 && (
                            <small>
                              本批次已接收 {message.batchCompleted}/
                              {message.batchTotal} 个文件
                            </small>
                          )}
                          {message.previewable &&
                            /\.(jpg|jpeg|png|gif|webp)$/i.test(
                              message.filename,
                            ) && (
                              <img
                                loading="lazy"
                                src={`/api/v1/chat/files/${message.attachmentId}/preview`}
                                alt={message.filename}
                              />
                            )}
                          {message.previewable &&
                            /\.mp4$/i.test(message.filename) && (
                              <video
                                controls
                                preload="metadata"
                                src={`/api/v1/chat/files/${message.attachmentId}/preview`}
                                aria-label={message.filename}
                              />
                            )}
                          <div>
                            <a
                              href={`/api/v1/chat/files/${message.attachmentId}/download`}
                            >
                              下载
                            </a>
                            {message.previewable && (
                              <a
                                href={`/api/v1/chat/files/${message.attachmentId}/preview`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                预览
                              </a>
                            )}
                            {message.relativePath && message.batchId && (
                              <a
                                href={`/api/v1/chat/conversations/${message.conversationId}/download-folder?batch=${encodeURIComponent(message.batchId)}&folder=${encodeURIComponent(message.relativePath.split("/")[0])}`}
                              >
                                {message.batchCompleted < message.batchTotal
                                  ? "下载已接收的文件"
                                  : "下载文件夹"}
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!message.recalled && (
                    <button
                      type="button"
                      className="text-button chat-reply"
                      onClick={() =>
                        setReplyTargets((current) => ({
                          ...current,
                          [message.conversationId]: message,
                        }))
                      }
                    >
                      回复
                    </button>
                  )}
                  {!message.recalled &&
                    message.author.id === session.user.id && (
                      <button
                        type="button"
                        className="text-button chat-recall"
                        onClick={() => void recall(message)}
                      >
                        撤回
                      </button>
                    )}
                </article>
              ))}
              <div ref={messageEnd} />
            </div>
            {uploads
              .filter((item) => item.conversationId === activeId)
              .map((task) => (
                <div className="chat-upload" key={task.key}>
                  <span>
                    {task.relativePath && `${task.relativePath}/`}
                    {task.file.name} ·{" "}
                    {task.status === "error"
                      ? task.error
                      : task.status === "queued"
                        ? "等待上传"
                        : task.status === "finishing"
                          ? "正在完成上传"
                          : `上传中 ${task.progress}%`}
                  </span>
                  {task.status === "error" && (
                    <button
                      type="button"
                      onClick={() =>
                        updateTask(task.key, { status: "queued", error: "" })
                      }
                    >
                      重试
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={task.status === "finishing"}
                    onClick={() => void removeUpload(task)}
                  >
                    {task.status === "uploading" ? "取消上传" : "移除"}
                  </button>
                </div>
              ))}
            {reading && (
              <p role="status" className="hint">
                正在读取文件夹…
              </p>
            )}
            <form className="chat-compose" onSubmit={send}>
              {replyTargets[active.id] && (
                <div className="chat-reply-target">
                  <span>
                    回复 {replyTargets[active.id]?.author.name}：
                    {replyTargets[active.id]?.content ||
                      replyTargets[active.id]?.filename}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setReplyTargets((current) => ({
                        ...current,
                        [active.id]: undefined,
                      }))
                    }
                  >
                    取消
                  </button>
                </div>
              )}
              <textarea
                ref={messageInput}
                role="combobox"
                aria-label="消息内容"
                placeholder="输入消息，或拖入文件 / 文件夹"
                maxLength={2000}
                rows={3}
                value={drafts[active.id] ?? ""}
                onChange={(event) => {
                  setDrafts((current) => ({
                    ...current,
                    [active.id]: event.target.value,
                  }));
                  updateMention(
                    event.target.value,
                    event.target.selectionStart,
                  );
                }}
                onClick={(event) =>
                  updateMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  )
                }
                aria-autocomplete="list"
                aria-expanded={Boolean(mention)}
                aria-controls={mention ? "chat-mention-results" : undefined}
                onKeyDown={(event) => {
                  if (
                    mention &&
                    mentionUsers.length &&
                    (event.key === "ArrowDown" || event.key === "ArrowUp")
                  ) {
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setMentionIndex(
                      (index) =>
                        (index + step + mentionUsers.length) %
                        mentionUsers.length,
                    );
                    return;
                  }
                  if (
                    mention &&
                    mentionUsers.length &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    (event.key === "Enter" || event.key === "Tab")
                  ) {
                    event.preventDefault();
                    chooseMention(mentionUsers[mentionIndex]);
                    return;
                  }
                  if (event.key === "Escape" && mention) {
                    event.preventDefault();
                    setMention(null);
                    return;
                  }
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    event.currentTarget.form
                      ?.querySelector<HTMLButtonElement>(
                        'button[type="submit"]',
                      )
                      ?.click();
                  }
                }}
              />
              {mention && (
                <div
                  id="chat-mention-results"
                  className="chat-mention-results"
                  role="listbox"
                  aria-label="选择提醒的员工"
                >
                  {mentionUsers.length ? (
                    mentionUsers.map((user, index) => (
                      <button
                        key={user.id}
                        type="button"
                        role="option"
                        aria-selected={index === mentionIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseMention(user)}
                      >
                        <strong>{user.name}</strong>
                        <span>@{user.username}</span>
                      </button>
                    ))
                  ) : (
                    <p>没有匹配的会话成员</p>
                  )}
                </div>
              )}
              <div>
                <button
                  type="button"
                  disabled={reading}
                  onClick={() => input.current?.click()}
                >
                  添加文件
                </button>
                <input
                  ref={input}
                  type="file"
                  hidden
                  multiple
                  aria-label="选择聊天文件"
                  onChange={(event) => {
                    addFiles(filesFromList(event.target.files));
                    event.target.value = "";
                  }}
                />
                <span>Ctrl + Enter 发送</span>
                <button
                  type="submit"
                  className="primary"
                  disabled={sending || !(drafts[active.id] ?? "").trim()}
                >
                  {sending ? "发送中…" : "发送"}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <div className="chat-empty">选择一个会话，或搜索员工发起私聊。</div>
        )}
      </div>
    </div>
  );
}
