import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  filesFromDrop,
  filesFromList,
  MAX_FILE_SIZE,
  PendingFileTree,
  type SelectedFile,
} from "./FilesPanel";
import { createCompatibleAbortController, readUtf8File } from "./browserCompat";
import {
  api,
  ApiError,
  errorMessage,
  type Session,
  type Project,
  type User,
} from "./api";
import {
  clearProjectDraft,
  draftTime,
  readProjectDraft,
  writeProjectDraft,
  type StoredDraft,
} from "./projectDrafts";
export const categories = ["软件", "设计", "数据", "文档", "其他"];

type CreateDraftValue = {
  name: string;
  category: string;
  summary: string;
  readme: string;
  demoEnabled: boolean;
  selected: User[];
};

export function ProjectForm({
  session,
  onCreated,
  onCancel,
  onExpired,
}: {
  session: Session;
  onCreated: (
    p: Project,
    files: SelectedFile[],
    demoFiles: SelectedFile[],
  ) => void;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const draftKey = `assets:project-create-draft:${session.user.id}`;
  const [query, setQuery] = useState(""),
    [users, setUsers] = useState<User[]>([]),
    [selected, setSelected] = useState<User[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [lookupError, setLookupError] = useState(""),
    [name, setName] = useState(""),
    [category, setCategory] = useState(categories[0]),
    [summary, setSummary] = useState(""),
    [readme, setReadme] = useState(""),
    [demoEnabled, setDemoEnabled] = useState(false),
    [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [recoverableDraft, setRecoverableDraft] =
    useState<StoredDraft<CreateDraftValue> | null>(() =>
      readProjectDraft<CreateDraftValue>(draftKey),
    );
  const fileInput = useRef<HTMLInputElement>(null);
  const projectFileInput = useRef<HTMLInputElement>(null);
  const demoFileInput = useRef<HTMLInputElement>(null);
  const [projectFiles, setProjectFiles] = useState<SelectedFile[]>([]);
  const [demoFiles, setDemoFiles] = useState<SelectedFile[]>([]);
  const [draggingDemoFiles, setDraggingDemoFiles] = useState(false);
  const [readingDemoFiles, setReadingDemoFiles] = useState(false);
  const [demoNotice, setDemoNotice] = useState("");
  const [demoError, setDemoError] = useState("");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const readingFilesRef = useRef(false);
  const [fileNotice, setFileNotice] = useState("");
  const [fileError, setFileError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const hasUnsavedChanges =
    dirty || projectFiles.length > 0 || demoFiles.length > 0 || readingFiles;

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(
      () =>
        writeProjectDraft<CreateDraftValue>(draftKey, {
          name,
          category,
          summary,
          readme,
          demoEnabled,
          selected,
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [category, demoEnabled, dirty, draftKey, name, readme, selected, summary]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty)
        writeProjectDraft<CreateDraftValue>(draftKey, {
          name,
          category,
          summary,
          readme,
          demoEnabled,
          selected,
        });
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [
    category,
    demoEnabled,
    dirty,
    draftKey,
    hasUnsavedChanges,
    name,
    readme,
    selected,
    summary,
  ]);

  function leave() {
    if (
      !hasUnsavedChanges ||
      window.confirm(
        "尚有未发布的内容。文字草稿会保存在本机，已选择文件不会保留，确定离开吗？",
      )
    ) {
      if (dirty)
        writeProjectDraft<CreateDraftValue>(draftKey, {
          name,
          category,
          summary,
          readme,
          demoEnabled,
          selected,
        });
      onCancel();
    }
  }

  function restoreDraft() {
    if (!recoverableDraft) return;
    const value = recoverableDraft.value;
    setName(value.name);
    setCategory(value.category);
    setSummary(value.summary);
    setReadme(value.readme);
    setDemoEnabled(value.demoEnabled);
    setSelected(value.selected);
    setRecoverableDraft(null);
    setDirty(true);
  }

  function discardDraft() {
    clearProjectDraft(draftKey);
    setRecoverableDraft(null);
  }

  async function importMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    setImportNotice("");
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setImportError("请选择 .md 或 .markdown 文件。");
      return;
    }
    if (file.size > 200000) {
      setImportError("项目说明文件不能超过 200 KB，请精简内容后重试。");
      return;
    }
    setImporting(true);
    try {
      const content = await readUtf8File(file);
      if (!content.trim()) {
        setImportError("文件内容为空，原有说明已保留。");
        return;
      }
      if (content.includes("\0")) {
        setImportError("文件包含非文本内容，请选择 Markdown 文本文件。");
        return;
      }
      if (
        readme.trim() &&
        !window.confirm("导入将替换当前项目说明，是否继续？")
      )
        return;
      setReadme(content);
      setDirty(true);
      setPreview(false);
      setImportNotice(`已导入 ${file.name}，可继续编辑，发布项目后保存。`);
    } catch {
      setImportError(
        "无法读取文件，请确认文件可访问且使用 UTF-8 编码。原有说明已保留。",
      );
    } finally {
      setImporting(false);
    }
  }

  function addProjectFiles(selectedFiles: SelectedFile[]) {
    setFileNotice("");
    setFileError("");
    if (!selectedFiles.length) {
      setFileNotice("没有找到可添加的文件。空文件夹不会上传。");
      return;
    }
    const invalid = selectedFiles.find(({ file }) => file.size > MAX_FILE_SIZE);
    if (invalid) {
      const path = invalid.relativePath
        ? `${invalid.relativePath}/${invalid.file.name}`
        : invalid.file.name;
      setFileError(`${path} 超过单文件 5 GB 上限，本次文件未添加。`);
      return;
    }
    setProjectFiles((current) => [...current, ...selectedFiles]);
    setFileNotice(`已添加 ${selectedFiles.length} 个文件到待上传列表。`);
  }

  async function dropProjectFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingFiles(false);
    if (readingFilesRef.current || busy) return;
    readingFilesRef.current = true;
    setReadingFiles(true);
    setFileError("");
    setFileNotice("");
    try {
      addProjectFiles(await filesFromDrop(event.dataTransfer));
    } catch {
      setFileError("无法读取拖入的文件或文件夹，请重新拖入或逐个选择文件。");
    } finally {
      readingFilesRef.current = false;
      setReadingFiles(false);
    }
  }

  function removeProjectFiles(selectedFiles: SelectedFile[]) {
    setFileNotice("");
    setProjectFiles((current) =>
      current.filter(
        (item) =>
          !selectedFiles.some(
            (selected) =>
              selected.file === item.file &&
              selected.relativePath === item.relativePath,
          ),
      ),
    );
  }

  function addDemoFiles(selectedFiles: SelectedFile[]) {
    setDemoNotice("");
    setDemoError("");
    if (!selectedFiles.length) {
      setDemoNotice("没有找到可添加的文件。空文件夹不会上传。");
      return;
    }
    const invalid = selectedFiles.find(({ file }) => file.size > MAX_FILE_SIZE);
    if (invalid) {
      const path = invalid.relativePath
        ? `${invalid.relativePath}/${invalid.file.name}`
        : invalid.file.name;
      setDemoError(`${path} 超过单文件 5 GB 上限，本次材料未添加。`);
      return;
    }
    setDemoFiles((current) => [...current, ...selectedFiles]);
    setDemoNotice(`已添加 ${selectedFiles.length} 个演示材料到待上传列表。`);
  }

  async function dropDemoFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingDemoFiles(false);
    if (readingFilesRef.current || busy) return;
    readingFilesRef.current = true;
    setReadingFiles(true);
    setReadingDemoFiles(true);
    setDemoError("");
    setDemoNotice("");
    try {
      addDemoFiles(await filesFromDrop(event.dataTransfer));
    } catch {
      setDemoError("无法读取拖入的演示材料，请重新拖入或逐个选择文件。");
    } finally {
      readingFilesRef.current = false;
      setReadingFiles(false);
      setReadingDemoFiles(false);
    }
  }

  function removeDemoFiles(selectedFiles: SelectedFile[]) {
    setDemoNotice("");
    setDemoFiles((current) =>
      current.filter(
        (item) =>
          !selectedFiles.some(
            (selected) =>
              selected.file === item.file &&
              selected.relativePath === item.relativePath,
          ),
      ),
    );
  }
  useEffect(() => {
    if (!query.startsWith("@")) {
      setUsers([]);
      setLookupError("");
      return;
    }
    const c = createCompatibleAbortController();
    const timer = setTimeout(() => {
      setLookupError("");
      api<{ items: User[] }>(
        "/users?q=" + encodeURIComponent(query.slice(1).trim()),
        { signal: c.signal },
      )
        .then((r) =>
          setUsers(
            r.items.filter(
              (u) =>
                u.id !== session.user.id &&
                !selected.some((item) => item.id === u.id),
            ),
          ),
        )
        .catch((e) => {
          if (!c.signal?.aborted) {
            if (e instanceof ApiError && e.status === 401) onExpired();
            else setLookupError(errorMessage(e));
          }
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [onExpired, query, selected, session.user.id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (importing || busy || readingFilesRef.current) return;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        scope: "all",
        q: name.trim(),
        category: "",
        sort: "updated",
        page: "1",
      });
      const existing = await api<{ items: Project[]; total: number }>(
        "/projects?" + params,
      );
      const candidates = [...existing.items];
      const pageCount = Math.ceil(existing.total / 20);
      for (let page = 2; page <= pageCount; page += 1) {
        params.set("page", String(page));
        const result = await api<{ items: Project[]; total: number }>(
          "/projects?" + params,
        );
        candidates.push(...result.items);
      }
      const duplicateCount = candidates.filter(
        (project) =>
          project.name.trim().toLocaleLowerCase("zh-CN") ===
          name.trim().toLocaleLowerCase("zh-CN"),
      ).length;
      if (
        duplicateCount > 0 &&
        !window.confirm(
          `已存在 ${duplicateCount} 个同名项目“${name.trim()}”，是否仍要创建？`,
        )
      )
        return;
      const created = await api<Project>(
        "/projects",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            category,
            summary,
            readme,
            demoEnabled,
            collaboratorIds: selected.map((u) => u.id),
          }),
        },
        session.csrfToken,
      );
      clearProjectDraft(draftKey);
      setRecoverableDraft(null);
      onCreated(created, projectFiles, demoEnabled ? demoFiles : []);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired();
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>创建项目</h1>
          <p>记录项目成果，邀请同事一起维护。</p>
        </div>
        <button onClick={leave} disabled={busy || importing || readingFiles}>
          返回列表
        </button>
      </div>
      {recoverableDraft && !dirty && (
        <div className="draft-recovery" role="status">
          <div>
            <strong>发现未发布草稿</strong>
            <p>
              保存于 {draftTime(recoverableDraft.savedAt)}，文件需要重新选择。
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
      <form className="project-form" onSubmit={submit}>
        <div className="two-columns">
          <label>
            项目名称
            <input
              required
              maxLength={120}
              placeholder="例如：客户数据治理方案"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            项目分类
            <select
              aria-label="项目分类"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setDirty(true);
              }}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          项目简介
          <textarea
            maxLength={500}
            rows={3}
            placeholder="简要说明项目用途与交付内容"
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        <div className="editor-title">
          <label htmlFor="readme">项目说明</label>
          <div className="editor-actions">
            <button
              type="button"
              disabled={busy || importing}
              onClick={() => fileInput.current?.click()}
            >
              {importing ? "正在读取…" : "导入 Markdown"}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".md,.markdown"
              aria-label="选择 Markdown 文件"
              onChange={(e) => void importMarkdown(e)}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => setPreview(!preview)}
            >
              {preview ? "继续编辑" : "预览 Markdown"}
            </button>
          </div>
        </div>
        <p className="hint">
          支持 UTF-8 编码的 .md / .markdown 文件，最大 200
          KB。只导入文字，文件中的本地图片不会自动上传。
        </p>
        {importError && (
          <p role="alert" className="error">
            {importError}
          </p>
        )}
        {importNotice && (
          <p role="status" className="success">
            {importNotice}
          </p>
        )}
        {preview ? (
          <article className="markdown preview">
            <Markdown remarkPlugins={[remarkGfm]}>
              {readme || "暂无说明"}
            </Markdown>
          </article>
        ) : (
          <textarea
            id="readme"
            className="readme-input"
            value={readme}
            disabled={importing}
            onChange={(e) => {
              setReadme(e.target.value);
              setDirty(true);
            }}
            rows={12}
            placeholder={"# 项目介绍\n\n项目背景、使用方式与注意事项…"}
          />
        )}
        <fieldset>
          <legend>项目文件</legend>
          <p className="hint">
            文件会先暂存在当前页面，每个文件最大 5 GB，目录结构会保留。
            发布项目后，在文件编辑页点击“保存修改”才会开始上传。
          </p>
          <div
            className={`file-drop-zone${draggingFiles ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDraggingFiles(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDraggingFiles(true);
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget;
              if (
                !(next instanceof Node) ||
                !event.currentTarget.contains(next)
              )
                setDraggingFiles(false);
            }}
            onDrop={(event) => void dropProjectFiles(event)}
          >
            <div className="file-drop-copy">
              <strong>
                {readingFiles && !readingDemoFiles
                  ? "正在读取文件夹，请稍候…"
                  : "拖入文件或整个文件夹"}
              </strong>
              <span>自动识别并保留文件夹结构；空文件夹不会上传。</span>
            </div>
            <button
              type="button"
              disabled={readingFiles || busy}
              onClick={() => projectFileInput.current?.click()}
            >
              添加文件
            </button>
            <input
              ref={projectFileInput}
              type="file"
              hidden
              multiple
              aria-label="选择待上传项目文件"
              onChange={(event) => {
                addProjectFiles(filesFromList(event.target.files));
                event.target.value = "";
              }}
            />
          </div>
          {((readingFiles && !readingDemoFiles) || fileNotice) && (
            <p role="status" className="hint">
              {readingFiles && !readingDemoFiles
                ? "正在读取文件和目录，完成后会显示在下方。"
                : fileNotice}
            </p>
          )}
          {fileError && (
            <p role="alert" className="error">
              {fileError}
            </p>
          )}
          {projectFiles.length > 0 && (
            <p className="hint">
              待上传：{projectFiles.length} 个文件。可展开文件夹查看和移除内容。
            </p>
          )}
          <PendingFileTree
            files={projectFiles}
            onRemove={(file) => removeProjectFiles([file])}
            onRemoveFolder={removeProjectFiles}
          />
        </fieldset>
        <fieldset>
          <legend>共创者</legend>
          <p className="hint">
            共创者的“我的项目”中会显示此项目。所有员工均可查看项目。
          </p>
          <input
            aria-label="搜索共创者"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入 @姓名或 @用户名"
          />
          {lookupError && (
            <p role="alert" className="error">
              {lookupError}
            </p>
          )}
          <div className="selected-users">
            {selected.map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => {
                  setSelected(selected.filter((v) => v.id !== u.id));
                  setDirty(true);
                }}
              >
                {u.name} · 移除
              </button>
            ))}
          </div>
          <div className="user-options">
            {users.map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => {
                  setSelected((current) => [...current, u]);
                  setDirty(true);
                  setQuery("");
                  setUsers([]);
                }}
              >
                <strong>{u.name}</strong>
                <span>@{u.username}</span>
              </button>
            ))}
            {query.startsWith("@") && !users.length && !lookupError && (
              <p className="hint">没有找到匹配的员工。</p>
            )}
          </div>
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={demoEnabled}
            disabled={readingFiles || busy}
            onChange={(event) => {
              const enabled = event.target.checked;
              if (
                !enabled &&
                demoFiles.length > 0 &&
                !window.confirm("关闭将移除已选择的演示材料，是否继续？")
              )
                return;
              if (!enabled) {
                setDemoFiles([]);
                setDemoNotice("");
                setDemoError("");
              }
              setDemoEnabled(enabled);
              setDirty(true);
            }}
          />
          <span>
            为此项目启用演示材料模块
            <small>启用后可添加图片、视频和演示文档。</small>
          </span>
        </label>
        {demoEnabled && (
          <fieldset>
            <legend>演示材料</legend>
            <p className="hint">
              材料会先暂存在当前页面。发布项目后，点击“保存修改”开始上传；每个文件最大
              5 GB。
            </p>
            <div
              className={`file-drop-zone${draggingDemoFiles ? " is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingDemoFiles(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDraggingDemoFiles(true);
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (
                  !(next instanceof Node) ||
                  !event.currentTarget.contains(next)
                )
                  setDraggingDemoFiles(false);
              }}
              onDrop={(event) => void dropDemoFiles(event)}
            >
              <div className="file-drop-copy">
                <strong>
                  {readingDemoFiles
                    ? "正在读取演示材料，请稍候…"
                    : "拖入演示文件或文件夹"}
                </strong>
                <span>
                  支持图片、视频、PDF 和其他演示文档，保留文件夹结构。
                </span>
              </div>
              <button
                type="button"
                disabled={readingFiles || busy}
                onClick={() => demoFileInput.current?.click()}
              >
                添加演示材料
              </button>
              <input
                ref={demoFileInput}
                type="file"
                hidden
                multiple
                aria-label="选择待上传演示材料"
                onChange={(event) => {
                  addDemoFiles(filesFromList(event.target.files));
                  event.target.value = "";
                }}
              />
            </div>
            {(readingDemoFiles || demoNotice) && (
              <p role="status" className="hint">
                {readingDemoFiles
                  ? "正在读取演示材料，完成后会显示在下方。"
                  : demoNotice}
              </p>
            )}
            {demoError && (
              <p role="alert" className="error">
                {demoError}
              </p>
            )}
            {demoFiles.length > 0 && (
              <p className="hint">
                待上传：{demoFiles.length}{" "}
                个演示材料。可展开文件夹查看和移除内容。
              </p>
            )}
            <PendingFileTree
              files={demoFiles}
              onRemove={(file) => removeDemoFiles([file])}
              onRemoveFolder={removeDemoFiles}
            />
          </fieldset>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            onClick={leave}
            disabled={busy || importing || readingFiles}
          >
            取消
          </button>
          <button
            className="primary"
            disabled={busy || importing || readingFiles}
          >
            {busy ? "正在发布…" : "发布项目"}
          </button>
        </div>
      </form>
    </>
  );
}
