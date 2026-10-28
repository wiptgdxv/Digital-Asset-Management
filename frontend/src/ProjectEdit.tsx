import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  ApiError,
  errorMessage,
  type Project,
  type Session,
  type User,
} from "./api";
import { categories } from "./ProjectForm";
import {
  FilesPanel,
  type FilesPanelHandle,
  type SelectedFile,
} from "./FilesPanel";
import { createCompatibleAbortController, readUtf8File } from "./browserCompat";
import {
  clearProjectDraft,
  draftTime,
  readProjectDraft,
  writeProjectDraft,
  type StoredDraft,
} from "./projectDrafts";

type Draft = {
  name: string;
  category: string;
  summary: string;
  readme: string;
  demoEnabled: boolean;
};

type EditSection = "details" | "files" | "members";

type EditDraftValue = {
  projectVersion: number;
  draft: Draft;
  selected: User[];
};

const draftFrom = (project: Project): Draft => ({
  name: project.name,
  category: project.category,
  summary: project.summary,
  readme: project.readme,
  demoEnabled: project.demoEnabled,
});

export function ProjectEdit({
  initialProject,
  session,
  onSaved,
  onCancel,
  onExpired,
  initialFiles = [],
  initialDemoFiles = [],
  onProjectChanged,
}: {
  initialProject: Project;
  session: Session;
  onSaved: (project: Project) => void;
  onCancel: () => void;
  onExpired: () => void;
  initialFiles?: SelectedFile[];
  initialDemoFiles?: SelectedFile[];
  onProjectChanged?: (project: Project) => void;
}) {
  const draftKey = `assets:project-edit-draft:${session.user.id}:${initialProject.id}`;
  const [project, setProject] = useState(initialProject);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initialProject));
  const [selected, setSelected] = useState<User[]>(
    initialProject.collaborators,
  );
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [projectFilesPending, setProjectFilesPending] = useState(
    initialFiles.length > 0,
  );
  const [demoFilesPending, setDemoFilesPending] = useState(
    initialDemoFiles.length > 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [recoverableDraft, setRecoverableDraft] =
    useState<StoredDraft<EditDraftValue> | null>(() =>
      readProjectDraft<EditDraftValue>(draftKey),
    );
  const [section, setSection] = useState<EditSection>(
    initialFiles.length || initialDemoFiles.length ? "files" : "details",
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const projectFiles = useRef<FilesPanelHandle>(null);
  const demoFiles = useRef<FilesPanelHandle>(null);
  const hasUnsavedChanges = dirty || projectFilesPending || demoFilesPending;
  const canManageCollaborators =
    session.user.id === project.author.id || session.user.isAdmin;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty)
        writeProjectDraft<EditDraftValue>(draftKey, {
          projectVersion: project.version,
          draft,
          selected,
        });
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft, draftKey, hasUnsavedChanges, project.version, selected]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(
      () =>
        writeProjectDraft<EditDraftValue>(draftKey, {
          projectVersion: project.version,
          draft,
          selected,
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [dirty, draft, draftKey, project.version, selected]);

  useEffect(() => {
    if (!canManageCollaborators || !query.startsWith("@")) {
      setUsers([]);
      setLookupError("");
      return;
    }
    const controller = createCompatibleAbortController();
    const timer = window.setTimeout(() => {
      setLookupError("");
      api<{ items: User[] }>(
        "/users?q=" + encodeURIComponent(query.slice(1).trim()),
        { signal: controller.signal },
      )
        .then((result) =>
          setUsers(
            result.items.filter(
              (user) =>
                user.id !== project.author.id &&
                !selected.some((item) => item.id === user.id),
            ),
          ),
        )
        .catch((reason) => {
          if (controller.signal?.aborted) return;
          if (reason instanceof ApiError && reason.status === 401) onExpired();
          else setLookupError(errorMessage(reason));
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canManageCollaborators, onExpired, project.author.id, query, selected]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setConflict(false);
    setError("");
  }

  function changeDemoEnabled(enabled: boolean) {
    if (
      !enabled &&
      demoFilesPending &&
      !window.confirm("关闭会移除尚未保存的演示材料，是否继续？")
    )
      return;
    if (!enabled) setDemoFilesPending(false);
    update("demoEnabled", enabled);
  }

  function leave() {
    if (
      !hasUnsavedChanges ||
      window.confirm(
        "尚有未保存的修改。文字草稿会保存在本机，待上传文件不会保留，确定离开吗？",
      )
    ) {
      if (dirty)
        writeProjectDraft<EditDraftValue>(draftKey, {
          projectVersion: project.version,
          draft,
          selected,
        });
      onCancel();
    }
  }

  function restoreDraft() {
    if (!recoverableDraft) return;
    setDraft(recoverableDraft.value.draft);
    setSelected(recoverableDraft.value.selected);
    setRecoverableDraft(null);
    setDirty(true);
    setConflict(false);
    setSection("details");
  }

  function discardDraft() {
    clearProjectDraft(draftKey);
    setRecoverableDraft(null);
  }

  async function importMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportNotice("");
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setError("请选择 .md 或 .markdown 文件。");
      return;
    }
    if (file.size > 200000) {
      setError("项目说明文件不能超过 200 KB。");
      return;
    }
    try {
      const content = await readUtf8File(file);
      if (!content.trim() || content.includes("\0")) {
        setError("文件不是有效的 Markdown 文本，原有说明已保留。");
        return;
      }
      if (
        draft.readme.trim() &&
        !window.confirm("导入将替换当前项目说明，是否继续？")
      )
        return;
      update("readme", content);
      setPreview(false);
      setImportNotice(`已导入 ${file.name}，保存后生效。`);
    } catch {
      setError("无法读取文件，请确认文件使用 UTF-8 编码。");
    }
  }

  async function reloadLatest() {
    setBusy(true);
    setError("");
    try {
      const latest = await api<Project>("/projects/" + project.id);
      setProject(latest);
      setDraft(draftFrom(latest));
      setSelected(latest.collaborators);
      setDirty(false);
      setConflict(false);
      setImportNotice("");
      clearProjectDraft(draftKey);
      setRecoverableDraft(null);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (dirty) {
        const saved = await api<Project>(
          "/projects/" + project.id,
          {
            method: "PUT",
            body: JSON.stringify({
              ...draft,
              version: project.version,
              collaboratorIds: selected.map((user) => user.id),
            }),
          },
          session.csrfToken,
        );
        setProject(saved);
        setDirty(false);
      }
      if (projectFilesPending) await projectFiles.current?.commit();
      if (demoFilesPending) await demoFiles.current?.commit();
      const latest = await api<Project>("/projects/" + project.id);
      setProjectFilesPending(false);
      setDemoFilesPending(false);
      clearProjectDraft(draftKey);
      setRecoverableDraft(null);
      onProjectChanged?.(latest);
      onSaved(latest);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onExpired();
      else if (reason instanceof ApiError && reason.status === 409) {
        setConflict(true);
        setSection("details");
      } else setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>编辑项目</h1>
          <p>修改项目资料。保存时会检查版本，避免覆盖其他同事的新修改。</p>
        </div>
        <button type="button" onClick={leave} disabled={busy}>
          返回项目
        </button>
      </div>
      {recoverableDraft && !dirty && (
        <div className="draft-recovery" role="status">
          <div>
            <strong>发现本地草稿</strong>
            <p>
              保存于 {draftTime(recoverableDraft.savedAt)}
              {recoverableDraft.value.projectVersion !== project.version
                ? `，项目已从版本 ${recoverableDraft.value.projectVersion} 更新到版本 ${project.version}，恢复后请核对内容。`
                : "，可以恢复后继续编辑。"}
            </p>
          </div>
          <div className="draft-recovery-actions">
            <button type="button" onClick={discardDraft}>
              删除草稿
            </button>
            <button type="button" className="primary" onClick={restoreDraft}>
              恢复草稿
            </button>
          </div>
        </div>
      )}
      <div className="edit-navigation">
        <div className="edit-tabs" role="tablist" aria-label="编辑项目分区">
          <button
            type="button"
            role="tab"
            aria-selected={section === "details"}
            aria-controls="edit-details"
            onClick={() => setSection("details")}
          >
            项目资料
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "files"}
            aria-controls="edit-files"
            onClick={() => setSection("files")}
          >
            文件与演示
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "members"}
            aria-controls="edit-members"
            onClick={() => setSection("members")}
          >
            协作成员
          </button>
        </div>
        <div className="edit-save-state">
          {hasUnsavedChanges && <span role="status">有未保存修改</span>}
          <button
            type="submit"
            form="project-edit-form"
            className="primary"
            disabled={busy || !hasUnsavedChanges}
          >
            {busy ? "正在保存…" : "保存修改"}
          </button>
        </div>
      </div>
      {((initialFiles.length > 0 && projectFilesPending) ||
        (initialDemoFiles.length > 0 && demoFilesPending)) && (
        <p role="status" className="hint edit-wide-notice">
          项目已创建，所选文件尚未上传。请点击上方“保存修改”开始上传，完成前请勿关闭页面。
        </p>
      )}
      {conflict && (
        <div className="conflict-notice edit-wide-notice" role="alert">
          <div>
            <strong>发现更新冲突</strong>
            <p>
              项目已被其他人更新，本次修改尚未覆盖对方内容。重新加载会放弃当前未保存修改。
            </p>
          </div>
          <button type="button" onClick={() => void reloadLatest()}>
            重新加载最新版本
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error edit-wide-notice">
          {error}
        </p>
      )}
      <form
        id="project-edit-form"
        className="project-form"
        onSubmit={submit}
        hidden={section === "files"}
      >
        <div className="edit-context">
          <span>当前版本 {project.version}</span>
          <span>作者：{project.author.name}</span>
        </div>
        <section
          id="edit-details"
          className="edit-section"
          role="tabpanel"
          hidden={section !== "details"}
        >
          <div className="edit-section-heading">
            <h2>项目资料</h2>
            <p>维护项目名称、介绍和对外展示的说明文档。</p>
          </div>
          <div className="two-columns">
            <label>
              项目名称
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <label>
              项目分类
              <select
                aria-label="项目分类"
                value={draft.category}
                onChange={(event) => update("category", event.target.value)}
              >
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            项目简介
            <textarea
              rows={3}
              maxLength={500}
              value={draft.summary}
              onChange={(event) => update("summary", event.target.value)}
            />
          </label>
          <div className="editor-title">
            <label htmlFor="edit-readme">项目说明</label>
            <div className="editor-actions">
              <button type="button" onClick={() => fileInput.current?.click()}>
                导入 Markdown
              </button>
              <input
                ref={fileInput}
                hidden
                type="file"
                accept=".md,.markdown"
                aria-label="选择 Markdown 文件"
                onChange={(event) => void importMarkdown(event)}
              />
              <button
                type="button"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? "继续编辑" : "预览 Markdown"}
              </button>
            </div>
          </div>
          {importNotice && (
            <p role="status" className="success">
              {importNotice}
            </p>
          )}
          {preview ? (
            <article className="markdown preview">
              <Markdown remarkPlugins={[remarkGfm]}>
                {draft.readme || "暂无说明"}
              </Markdown>
            </article>
          ) : (
            <textarea
              id="edit-readme"
              className="readme-input"
              rows={12}
              maxLength={200000}
              value={draft.readme}
              onChange={(event) => update("readme", event.target.value)}
            />
          )}
        </section>
        <section
          id="edit-members"
          className="edit-section"
          role="tabpanel"
          hidden={section !== "members"}
        >
          <div className="edit-section-heading">
            <h2>协作成员</h2>
            <p>管理共同维护项目的员工及其“我的项目”归属。</p>
          </div>
          <fieldset>
            <legend>共创者</legend>
            {canManageCollaborators ? (
              <>
                <p className="hint">
                  项目作者和管理员可以增减共创者。加入后，项目会出现在对方的“我的项目”。
                </p>
                <input
                  aria-label="搜索共创者"
                  placeholder="输入 @姓名或 @用户名"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {lookupError && (
                  <p role="alert" className="error">
                    {lookupError}
                  </p>
                )}
                <div className="selected-users">
                  {selected.map((user) => (
                    <button
                      type="button"
                      key={user.id}
                      onClick={() => {
                        setSelected((current) =>
                          current.filter((item) => item.id !== user.id),
                        );
                        setDirty(true);
                        setConflict(false);
                      }}
                    >
                      {user.name} · 移除
                    </button>
                  ))}
                </div>
                <div className="user-options">
                  {users.map((user) => (
                    <button
                      type="button"
                      key={user.id}
                      onClick={() => {
                        setSelected((current) => [...current, user]);
                        setQuery("");
                        setUsers([]);
                        setDirty(true);
                        setConflict(false);
                      }}
                    >
                      <strong>{user.name}</strong>
                      <span>@{user.username}</span>
                    </button>
                  ))}
                  {query.startsWith("@") && !users.length && !lookupError && (
                    <p className="hint">没有找到匹配的员工。</p>
                  )}
                </div>
              </>
            ) : (
              <div className="readonly-members">
                <p>
                  {selected.map((user) => user.name).join("、") || "暂无共创者"}
                </p>
                <span>
                  你可以编辑项目内容，但只有作者或管理员可以调整共创者。
                </span>
              </div>
            )}
          </fieldset>
        </section>
      </form>
      <div
        id="edit-files"
        className="edit-file-management"
        role="tabpanel"
        hidden={section !== "files"}
      >
        {!draft.demoEnabled && (
          <section className="readme-panel files-panel demo-module-panel">
            <div className="editor-title">
              <h2>演示材料</h2>
              <div className="editor-actions">
                <label className="demo-module-toggle">
                  <input
                    type="checkbox"
                    aria-label="为此项目启用演示材料模块"
                    checked={draft.demoEnabled}
                    onChange={(event) =>
                      changeDemoEnabled(event.target.checked)
                    }
                  />
                  <span>启用模块</span>
                </label>
              </div>
            </div>
            <p className="hint">
              {project.demoEnabled
                ? "保存后演示材料将从项目详情中隐藏；已上传材料会保留，重新启用后可以继续使用。"
                : "启用后可直接在这里添加图片、PDF、视频、演示文稿或其他材料。"}
            </p>
          </section>
        )}
        {draft.demoEnabled && (
          <FilesPanel
            ref={demoFiles}
            projectId={project.id}
            session={session}
            kind="demo"
            initialFiles={initialDemoFiles}
            editable
            deferInitialLoad={!project.demoEnabled}
            onPendingChange={setDemoFilesPending}
            headerAction={
              <label className="demo-module-toggle">
                <input
                  type="checkbox"
                  aria-label="为此项目启用演示材料模块"
                  checked={draft.demoEnabled}
                  onChange={(event) => changeDemoEnabled(event.target.checked)}
                />
                <span>已启用</span>
              </label>
            }
          />
        )}
        <FilesPanel
          ref={projectFiles}
          projectId={project.id}
          session={session}
          initialFiles={initialFiles}
          editable
          onPendingChange={setProjectFilesPending}
        />
      </div>
    </>
  );
}
