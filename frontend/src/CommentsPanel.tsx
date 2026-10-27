import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  api,
  ApiError,
  errorMessage,
  type Comment,
  type Reply,
  type Session,
  type User,
} from "./api";
import { createCompatibleAbortController } from "./browserCompat";

const displayTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

function UserAvatar({ user }: { user: User }) {
  return (
    <span className="comment-avatar" aria-hidden="true">
      {user.name.trim().slice(0, 1) || user.username.slice(0, 1).toUpperCase()}
    </span>
  );
}

function MentionText({ content }: { content: string }) {
  const pattern = /(^|[^A-Za-z0-9._-])@([\p{L}\p{N}._-]{2,32})/gu;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const mentionStart = (match.index ?? 0) + match[1].length;
    if (mentionStart > cursor) parts.push(content.slice(cursor, mentionStart));
    const mention = `@${match[2]}`;
    parts.push(
      <span className="mention" key={`${mentionStart}-${mention}`}>
        {mention}
      </span>,
    );
    cursor = mentionStart + mention.length;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return parts;
}

type ActiveMention = { start: number; end: number; query: string };

function findActiveMention(
  value: string,
  cursor: number,
): ActiveMention | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(
    /(?:^|[^A-Za-z0-9._-])@([\p{L}\p{N}._-]{0,32})$/u,
  );
  if (!match || match.index === undefined) return null;
  const query = match[1];
  return { start: cursor - query.length - 1, end: cursor, query };
}

function MentionTextarea({
  id,
  label,
  placeholder,
  value,
  onChange,
  rows,
  session,
  onExpired,
  autoFocus = false,
  onSubmitShortcut,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  session: Session;
  onExpired: () => void;
  autoFocus?: boolean;
  onSubmitShortcut?: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const listId = `${id}-mentions`;

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    if (!mention) {
      setUsers([]);
      setSearching(false);
      setLookupFailed(false);
      return;
    }
    const controller = createCompatibleAbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setLookupFailed(false);
      api<{ items: User[] }>("/users?q=" + encodeURIComponent(mention.query), {
        signal: controller.signal,
      })
        .then((result) => {
          setUsers(
            result.items
              .filter((user) => user.id !== session.user.id)
              .slice(0, 8),
          );
          setSelected(0);
        })
        .catch((reason) => {
          if (!controller.signal?.aborted) {
            if (reason instanceof ApiError && reason.status === 401)
              onExpired();
            else {
              setUsers([]);
              setLookupFailed(true);
            }
          }
        })
        .finally(() => {
          if (!controller.signal?.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mention?.query, onExpired, session.user.id]);

  function updateMention(nextValue: string, cursor: number | null) {
    setMention(findActiveMention(nextValue, cursor ?? nextValue.length));
  }

  function choose(user: User) {
    if (!mention) return;
    const inserted = `@${user.username} `;
    const next =
      value.slice(0, mention.start) + inserted + value.slice(mention.end);
    const cursor = mention.start + inserted.length;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(cursor, cursor);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmitShortcut?.();
      return;
    }
    if (!mention || !users.length) {
      if (event.key === "Escape") setMention(null);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((current) => (current + step + users.length) % users.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(users[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMention(null);
    }
  }

  return (
    <div className="mention-composer">
      <label htmlFor={id}>{label}</label>
      <textarea
        ref={textarea}
        role="combobox"
        id={id}
        placeholder={placeholder}
        value={value}
        maxLength={2000}
        onChange={(event) => {
          onChange(event.target.value);
          updateMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) =>
          updateMention(
            event.currentTarget.value,
            event.currentTarget.selectionStart,
          )
        }
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-controls={mention ? listId : undefined}
        aria-expanded={Boolean(mention)}
        aria-activedescendant={
          mention && users[selected]
            ? `${listId}-${users[selected].id}`
            : undefined
        }
        required
        rows={rows}
        autoFocus={autoFocus}
      />
      {mention && (
        <div className="mention-results" id={listId} role="listbox">
          {searching ? (
            <p role="status">正在查找员工…</p>
          ) : lookupFailed ? (
            <p>暂时无法查找员工，请稍后重试。</p>
          ) : users.length ? (
            users.map((user, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                id={`${listId}-${user.id}`}
                className={index === selected ? "is-selected" : ""}
                key={user.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(user)}
              >
                <strong>{user.name}</strong>
                <span>@{user.username}</span>
              </button>
            ))
          ) : (
            <p>没有匹配的员工。</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CommentsPanel({
  projectId,
  session,
  onExpired,
  targetCommentId = null,
  onTargetHandled,
}: {
  projectId: number;
  session: Session;
  onExpired: () => void;
  targetCommentId?: number | null;
  onTargetHandled?: () => void;
}) {
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(
    () => new Set(),
  );
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadRevision, setLoadRevision] = useState(0);
  const [error, setError] = useState("");
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyTarget, setReplyTarget] = useState<User | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [highlightedCommentId, setHighlightedCommentId] = useState<
    number | null
  >(null);
  const replyContent =
    replyingTo === null ? "" : (replyDrafts[replyingTo] ?? "");

  function setReplyContent(content: string) {
    if (replyingTo === null) return;
    setReplyDrafts((current) => ({ ...current, [replyingTo]: content }));
  }

  function openReply(comment: Comment, target: User, mentionTarget = false) {
    setReplyingTo(comment.id);
    setReplyTarget(target);
    setRepliesExpanded(comment.id, true);
    setReplyError("");
    if (mentionTarget) {
      setReplyDrafts((current) => {
        const existing = current[comment.id] ?? "";
        const mention = `@${target.username} `;
        if (existing.includes(mention.trim())) return current;
        return { ...current, [comment.id]: mention + existing };
      });
    }
  }
  function setRepliesExpanded(commentId: number, shouldExpand: boolean) {
    setExpandedReplies((current) => {
      const next = new Set(current);
      if (shouldExpand) next.add(commentId);
      else next.delete(commentId);
      return next;
    });
  }

  const handleError = useCallback(
    (reason: unknown, setMessage: (message: string) => void) => {
      if (reason instanceof ApiError && reason.status === 401) {
        onExpired();
        return;
      }
      setMessage(errorMessage(reason));
    },
    [onExpired],
  );

  useEffect(() => {
    const controller = createCompatibleAbortController();
    setLoading(true);
    setError("");
    api<{ items: Comment[] }>("/projects/" + projectId + "/comments", {
      signal: controller.signal,
    })
      .then((result) => setComments(result.items))
      .catch((reason) => {
        if (!controller.signal?.aborted) handleError(reason, setError);
      })
      .finally(() => {
        if (!controller.signal?.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [handleError, loadRevision, projectId]);

  useEffect(() => {
    if (loading || !targetCommentId) return;
    const parent = comments.find(
      (comment) =>
        comment.id === targetCommentId ||
        comment.replies.some((reply) => reply.id === targetCommentId),
    );
    if (!parent) {
      onTargetHandled?.();
      return;
    }
    if (parent.id !== targetCommentId) setRepliesExpanded(parent.id, true);

    const locateTimer = window.setTimeout(() => {
      const target = document.getElementById(
        `project-comment-${targetCommentId}`,
      );
      if (!target) {
        onTargetHandled?.();
        return;
      }
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
      target.focus({ preventScroll: true });
      setHighlightedCommentId(targetCommentId);
      onTargetHandled?.();
    }, 50);
    return () => window.clearTimeout(locateTimer);
  }, [comments, loading, onTargetHandled, targetCommentId]);

  useEffect(() => {
    if (!highlightedCommentId) return;
    const timer = window.setTimeout(() => setHighlightedCommentId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlightedCommentId]);

  async function submitComment(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = newContent.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const comment = await api<Comment>(
        "/projects/" + projectId + "/comments",
        { method: "POST", body: JSON.stringify({ content }) },
        session.csrfToken,
      );
      setComments((current) => [comment, ...current]);
      setNewContent("");
    } catch (reason) {
      handleError(reason, setError);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(commentId: number) {
    const content = replyContent.trim();
    if (!content || replySubmitting) return;
    setReplySubmitting(true);
    setReplyError("");
    try {
      const reply = await api<Reply>(
        "/comments/" + commentId + "/replies",
        { method: "POST", body: JSON.stringify({ content }) },
        session.csrfToken,
      );
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? { ...comment, replies: [...comment.replies, reply] }
            : comment,
        ),
      );
      setRepliesExpanded(commentId, true);
      setReplyDrafts((current) => ({ ...current, [commentId]: "" }));
      setReplyingTo(null);
      setReplyTarget(null);
    } catch (reason) {
      handleError(reason, setReplyError);
    } finally {
      setReplySubmitting(false);
    }
  }

  return (
    <section className="readme-panel comments-panel">
      <div className="comments-heading">
        <h2>评论与回复</h2>
        {!loading && !error && <span>{comments.length} 条评论</span>}
      </div>
      {loading ? (
        <p className="comment-status" role="status">
          正在加载评论…
        </p>
      ) : error && comments.length === 0 ? (
        <div className="comment-load-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setLoadRevision((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={submitComment} className="comment-form">
            <MentionTextarea
              id="new-comment"
              label="发表评论"
              placeholder="分享建议、问题或项目进展"
              value={newContent}
              onChange={setNewContent}
              rows={3}
              session={session}
              onExpired={onExpired}
              onSubmitShortcut={() => void submitComment()}
            />
            <div className="comment-actions">
              <span className="composer-guide">
                输入 @ 提醒同事 · Ctrl + Enter 发布
              </span>
              <span className="character-count">{newContent.length}/2000</span>
              <button
                className="primary"
                type="submit"
                disabled={submitting || !newContent.trim()}
              >
                {submitting ? "正在发表…" : "发表评论"}
              </button>
            </div>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {comments.length === 0 ? (
            <p className="comment-status">暂无评论，可以发表第一条意见。</p>
          ) : (
            <ul className="comment-list">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  id={`project-comment-${comment.id}`}
                  tabIndex={-1}
                  className={`comment-item${
                    highlightedCommentId === comment.id ? " is-targeted" : ""
                  }`}
                >
                  <UserAvatar user={comment.user} />
                  <div className="comment-thread-body">
                    <div className="comment-header">
                      <strong>{comment.user.name}</strong>
                      <span>@{comment.user.username}</span>
                      <time
                        dateTime={comment.createdAt}
                        title={displayTime(comment.createdAt)}
                      >
                        {displayTime(comment.createdAt)}
                      </time>
                    </div>
                    <p className="comment-content">
                      <MentionText content={comment.content} />
                    </p>
                    <div className="comment-thread-actions">
                      <button
                        type="button"
                        className="text-button"
                        aria-expanded={replyingTo === comment.id}
                        onClick={() => {
                          if (
                            replyingTo === comment.id &&
                            replyTarget?.id === comment.user.id
                          ) {
                            setReplyingTo(null);
                            setReplyTarget(null);
                          } else {
                            openReply(comment, comment.user);
                          }
                        }}
                      >
                        回复
                      </button>
                      {comment.replies.length > 0 && (
                        <button
                          type="button"
                          className="text-button replies-toggle"
                          aria-expanded={expandedReplies.has(comment.id)}
                          aria-controls={`comment-replies-${comment.id}`}
                          onClick={() =>
                            setRepliesExpanded(
                              comment.id,
                              !expandedReplies.has(comment.id),
                            )
                          }
                        >
                          {expandedReplies.has(comment.id)
                            ? "收起回复"
                            : `展开 ${comment.replies.length} 条回复`}
                        </button>
                      )}
                    </div>
                    {comment.replies.length > 0 &&
                      expandedReplies.has(comment.id) && (
                        <ul
                          className="reply-list"
                          id={`comment-replies-${comment.id}`}
                        >
                          {comment.replies.map((reply) => (
                            <li
                              key={reply.id}
                              id={`project-comment-${reply.id}`}
                              tabIndex={-1}
                              className={`reply-item${
                                highlightedCommentId === reply.id
                                  ? " is-targeted"
                                  : ""
                              }`}
                            >
                              <UserAvatar user={reply.user} />
                              <div className="reply-body">
                                <div className="comment-header">
                                  <strong>{reply.user.name}</strong>
                                  <span>@{reply.user.username}</span>
                                  <time
                                    dateTime={reply.createdAt}
                                    title={displayTime(reply.createdAt)}
                                  >
                                    {displayTime(reply.createdAt)}
                                  </time>
                                </div>
                                <p className="comment-content">
                                  <MentionText content={reply.content} />
                                </p>
                                <button
                                  type="button"
                                  className="text-button reply-to-reply"
                                  onClick={() =>
                                    openReply(comment, reply.user, true)
                                  }
                                >
                                  回复
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    {replyingTo === comment.id && (
                      <form
                        className="reply-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitReply(comment.id);
                        }}
                      >
                        <div className="reply-form-heading">
                          <span>
                            回复 {replyTarget?.name ?? comment.user.name}
                          </span>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setReplyingTo(null);
                              setReplyTarget(null);
                            }}
                          >
                            取消
                          </button>
                        </div>
                        <MentionTextarea
                          key={`${comment.id}-${replyTarget?.id ?? "comment"}`}
                          id={`reply-${comment.id}`}
                          label="回复评论"
                          placeholder="写下回复，输入 @ 可以提醒同事"
                          value={replyContent}
                          onChange={setReplyContent}
                          rows={2}
                          session={session}
                          onExpired={onExpired}
                          autoFocus
                          onSubmitShortcut={() => void submitReply(comment.id)}
                        />
                        {replyError && (
                          <p role="alert" className="error">
                            {replyError}
                          </p>
                        )}
                        <div className="comment-actions">
                          <span className="composer-guide">
                            Ctrl + Enter 发送
                          </span>
                          <span className="character-count">
                            {replyContent.length}/2000
                          </span>
                          <button
                            type="submit"
                            disabled={replySubmitting || !replyContent.trim()}
                          >
                            {replySubmitting ? "正在回复…" : "提交回复"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
