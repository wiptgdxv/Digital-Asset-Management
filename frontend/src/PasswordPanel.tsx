import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage, type Session } from "./api";

export function PasswordPanel({
  session,
  required = false,
  onChanged,
  onCancel,
  onExpired,
}: {
  session: Session;
  required?: boolean;
  onChanged: (session: Session) => void;
  onCancel?: () => void;
  onExpired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        "/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword }),
        },
        session.csrfToken,
      );
      form.reset();
      onChanged({ ...session, mustChangePassword: false });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST" }, session.csrfToken);
      onExpired();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      <div className="page-title password-title">
        <div className="page-title-copy">
          <h1>{required ? "设置新密码" : "修改密码"}</h1>
          <p>
            {required
              ? `管理员已重置 @${session.user.username} 的密码，继续使用前请设置新密码。`
              : "修改后，其他设备上的登录会话将自动退出。"}
          </p>
        </div>
      </div>
      <section className="password-panel">
        <form onSubmit={submit}>
          <label>
            {required ? "临时密码" : "当前密码"}
            <input
              name="currentPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="current-password"
            />
          </label>
          <label>
            新密码
            <input
              name="newPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
          <label>
            再次输入新密码
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
          <p className="hint">密码长度为 8–72 个字符，且不能与当前密码相同。</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="password-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "正在保存…" : "保存新密码"}
            </button>
            {required ? (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void logout()}
              >
                退出登录
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={onCancel}>
                取消
              </button>
            )}
          </div>
        </form>
      </section>
    </>
  );

  return required ? <main className="password-gate">{content}</main> : content;
}
