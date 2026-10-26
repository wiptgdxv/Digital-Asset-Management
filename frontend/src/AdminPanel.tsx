import { useEffect, useState } from "react";
import { api, ApiError, errorMessage, type Session, type User } from "./api";
import { copyText, createCompatibleAbortController } from "./browserCompat";

export function AdminPanel({
  session,
  onExpired,
  onChangeOwnPassword,
}: {
  session: Session;
  onExpired: () => void;
  onChangeOwnPassword: () => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [resetResult, setResetResult] = useState<{
    user: User;
    temporaryPassword: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = createCompatibleAbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api<{ items: User[] }>("/users?q=" + encodeURIComponent(query), {
        signal: controller.signal,
      })
        .then((result) => setUsers(result.items))
        .catch((reason) => {
          if (controller.signal?.aborted) return;
          if (reason instanceof ApiError && reason.status === 401) onExpired();
          else setError(errorMessage(reason));
        })
        .finally(() => {
          if (!controller.signal?.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [onExpired, query]);

  async function changeRole(user: User) {
    const next = !user.isAdmin;
    if (
      !window.confirm(
        next
          ? `确定授予 ${user.name} 管理员权限吗？`
          : `确定撤销 ${user.name} 的管理员权限吗？`,
      )
    )
      return;
    setChangingId(user.id);
    setError("");
    try {
      const updated = await api<User>(
        `/users/${user.id}/admin`,
        { method: "PUT", body: JSON.stringify({ isAdmin: next }) },
        session.csrfToken,
      );
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setChangingId(null);
    }
  }

  async function resetPassword(user: User) {
    if (
      !window.confirm(
        `确定重置 ${user.name} 的密码吗？该员工当前的所有登录会话都会退出。`,
      )
    )
      return;
    setResettingId(user.id);
    setResetResult(null);
    setCopied(false);
    setError("");
    try {
      const result = await api<{ temporaryPassword: string }>(
        `/users/${user.id}/reset-password`,
        { method: "POST" },
        session.csrfToken,
      );
      setResetResult({ user, temporaryPassword: result.temporaryPassword });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setResettingId(null);
    }
  }

  async function copyTemporaryPassword() {
    if (!resetResult) return;
    try {
      await copyText(resetResult.temporaryPassword);
      setCopied(true);
    } catch {
      setError("无法自动复制，请手动选择临时密码复制。 ");
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>员工权限</h1>
          <p>管理管理员权限，并为忘记密码的员工生成一次性临时密码。</p>
        </div>
      </div>
      <section className="admin-panel">
        <label htmlFor="admin-search">查找员工</label>
        <input
          id="admin-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名或用户名"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {resetResult && (
          <div className="password-reset-result" role="status">
            <div>
              <strong>{resetResult.user.name} 的临时密码</strong>
              <p>该密码只显示这一次，请安全交给员工。</p>
            </div>
            <code>{resetResult.temporaryPassword}</code>
            <div className="reset-result-actions">
              <button
                type="button"
                onClick={() => void copyTemporaryPassword()}
              >
                {copied ? "已复制" : "复制密码"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setResetResult(null)}
              >
                关闭
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <p className="admin-status" role="status">
            正在加载员工…
          </p>
        ) : (
          <div className="table-scroll admin-table">
            <table>
              <thead>
                <tr>
                  <th>员工</th>
                  <th>用户名</th>
                  <th>当前权限</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>@{user.username}</td>
                    <td>{user.isAdmin ? "管理员" : "普通员工"}</td>
                    <td>
                      <div className="admin-actions">
                        <button
                          type="button"
                          onClick={() => void changeRole(user)}
                          disabled={changingId !== null || resettingId !== null}
                        >
                          {changingId === user.id
                            ? "正在保存…"
                            : user.isAdmin
                              ? "撤销管理员"
                              : "设为管理员"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            user.id === session.user.id
                              ? onChangeOwnPassword()
                              : void resetPassword(user)
                          }
                          disabled={changingId !== null || resettingId !== null}
                        >
                          {resettingId === user.id
                            ? "正在重置…"
                            : user.id === session.user.id
                              ? "修改密码"
                              : "重置密码"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
