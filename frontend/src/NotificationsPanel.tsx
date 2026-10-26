import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  errorMessage,
  type NotificationsResponse,
  type Session,
} from "./api";

const displayTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

export function NotificationsPanel({
  session,
  onExpired,
  onUnreadChange,
  onOpenProject,
}: {
  session: Session;
  onExpired: () => void;
  onUnreadChange: (count: number) => void;
  onOpenProject: (id: number) => void;
}) {
  const [data, setData] = useState<NotificationsResponse>({
    items: [],
    unread: 0,
  });
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await api<NotificationsResponse>("/notifications");
      setData(result);
      onUnreadChange(result.unread);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [onExpired, onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    if (!data.unread || marking) return;
    setMarking(true);
    setError("");
    try {
      await api("/notifications/read", { method: "POST" }, session.csrfToken);
      setData((current) => ({
        unread: 0,
        items: current.items.map((item) => ({ ...item, isRead: true })),
      }));
      onUnreadChange(0);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setMarking(false);
    }
  }

  return (
    <>
      <div className="page-title notification-title">
        <div className="page-title-copy">
          <h1>提醒</h1>
          <p>同事在评论或回复中提到你时，会在这里留下记录。</p>
        </div>
        <button
          type="button"
          disabled={!data.unread || marking}
          onClick={() => void markAllRead()}
        >
          {marking ? "正在处理…" : "全部标为已读"}
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {loading ? (
        <p className="empty" role="status">
          正在加载提醒…
        </p>
      ) : data.items.length === 0 ? (
        <div className="empty">
          <h2>暂无提醒</h2>
          <p>评论中使用 @用户名，即可提醒对应同事。</p>
        </div>
      ) : (
        <section className="notification-list" aria-label="提醒列表">
          {data.items.map((item) => (
            <article
              key={item.id}
              className={`notification-item${item.isRead ? "" : " is-unread"}`}
            >
              <span className="notification-state" aria-hidden="true" />
              <div>
                <p>
                  <strong>{item.actor.name}</strong> 在项目
                  <button
                    type="button"
                    className="text-button notification-project"
                    onClick={() => onOpenProject(item.projectId)}
                  >
                    {item.projectName}
                  </button>
                  中提到了你
                </p>
                <blockquote>{item.content}</blockquote>
                <time dateTime={item.createdAt}>
                  {displayTime(item.createdAt)}
                </time>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
