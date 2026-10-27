import { useState, type FormEvent } from "react";
import { api, errorMessage, type Session } from "./api";
export function Auth({ onLogin }: { onLogin: (session: Session) => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const data = {
      ...(register ? { name: String(form.get("name") ?? "") } : {}),
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    try {
      if (register) {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify(data),
        });
        setRegister(false);
        setMessage("注册成功，请使用用户名和密码登录。");
      } else
        onLogin(
          await api<Session>("/auth/login", {
            method: "POST",
            body: JSON.stringify(data),
          }),
        );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="auth-brand" aria-label="大数据实战中心">
          <img
            className="auth-emblem"
            src="/assets/police-emblem.png"
            alt="警徽"
          />
          <div>
            <strong>大数据实战中心</strong>
            <span>数字资产管理中心</span>
          </div>
        </div>
        <div className="auth-intro">
          <h1>
            让每一份成果，
            <br />
            都能被团队找到。
          </h1>
          <p>
            项目说明、交付文件与共创记录，
            <br />
            在同一个工作空间中持续积累。
          </p>
        </div>
        <small>公司内网 · 团队共享</small>
      </div>
      <main className="auth-main">
        <form onSubmit={submit} className="auth-form">
          <h2>{register ? "创建员工账号" : "登录工作空间"}</h2>
          <p className="muted">
            {register
              ? "设置唯一用户名，便于登录和同事查找。"
              : "欢迎回来，继续你的项目协作。"}
          </p>
          {register && (
            <label>
              姓名
              <input name="name" required maxLength={60} autoComplete="name" />
            </label>
          )}
          <label>
            用户名
            <input
              name="username"
              type="text"
              required
              minLength={2}
              maxLength={32}
              pattern="[\p{L}\p{N}._-]+"
              title="请输入 2–32 位中英文、数字、点、下划线或短横线"
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          <p className="hint">
            用户名支持 2–32 位中英文、数字、点、下划线和短横线；密码至少 8 个字符。
          </p>
          {!register && (
            <p className="forgot-password">忘记密码？请联系系统管理员重置。</p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="success">
              {message}
            </p>
          )}
          <button disabled={busy} className="primary wide">
            {busy ? "正在处理…" : register ? "注册账号" : "登录"}
          </button>
          <button
            type="button"
            className="text-button wide"
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setError("");
              setMessage("");
            }}
          >
            {register ? "已有账号，返回登录" : "还没有账号？自行注册"}
          </button>
        </form>
      </main>
    </div>
  );
}
