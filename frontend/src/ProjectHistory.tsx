import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  errorMessage,
  type Project,
  type ProjectHistoryItem,
  type ProjectHistoryResponse,
} from "./api";
import { createCompatibleAbortController } from "./browserCompat";

const fieldNames: Record<string, string> = {
  created: "创建项目",
  baseline: "建立历史基线",
  name: "项目名称",
  summary: "项目简介",
  readme: "项目说明",
  category: "项目分类",
  demoEnabled: "演示材料开关",
  collaborators: "共创者",
};

const actionNames: Record<ProjectHistoryItem["action"], string> = {
  create: "创建",
  edit: "编辑",
  restore: "恢复",
  baseline: "历史基线",
};

const displayTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

export function ProjectHistory({
  project,
  onExpired,
}: {
  project: Project;
  onExpired: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<ProjectHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const contentId = `project-history-content-${project.id}`;

  useEffect(() => {
    const controller = createCompatibleAbortController();
    setLoading(true);
    setError("");
    api<ProjectHistoryResponse>(`/projects/${project.id}/history?page=1`, {
      signal: controller.signal,
    })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        setPage(1);
      })
      .catch((reason) => {
        if (controller.signal?.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) onExpired();
        else setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal?.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onExpired, project.id, project.version, revision]);

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError("");
    try {
      const nextPage = page + 1;
      const result = await api<ProjectHistoryResponse>(
        `/projects/${project.id}/history?page=${nextPage}`,
      );
      setItems((current) => [...current, ...result.items]);
      setTotal(result.total);
      setPage(nextPage);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleItems = expanded ? items : items.slice(0, 1);

  return (
    <section className="readme-panel history-panel">
      <div className="history-heading">
        <div>
          <h2>编辑历史</h2>
          <p>默认显示最近一次修改，可展开查看全部记录。</p>
        </div>
        <div className="section-heading-actions">
          {!loading && !error && <span>共 {total} 个版本</span>}
          {!loading && !error && total > 1 && (
            <button
              type="button"
              className="section-toggle"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "只看最新" : "展开全部历史"}
            </button>
          )}
        </div>
      </div>
      <div id={contentId} className="collapsible-content">
        {error && (
          <div className="history-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              重新加载
            </button>
          </div>
        )}
        {loading ? (
          <p className="history-status" role="status">
            正在加载编辑历史…
          </p>
        ) : items.length === 0 ? (
          <p className="history-status">暂无编辑历史。</p>
        ) : (
          <>
            <ol className="history-list">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <div className="history-version">
                    <strong>版本 {item.version}</strong>
                    <span>{actionNames[item.action]}</span>
                  </div>
                  <div className="history-detail">
                    <p>
                      {item.action === "restore" && item.restoredFromVersion > 0
                        ? `历史恢复自版本 ${item.restoredFromVersion}`
                        : item.changedFields
                            .map((field) => fieldNames[field] ?? field)
                            .join("、") || "未检测到字段变化"}
                    </p>
                    <span>
                      {item.editor.name} · {displayTime(item.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            {expanded && items.length < total && (
              <button
                type="button"
                className="history-more"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "正在加载…" : "加载更早记录"}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
