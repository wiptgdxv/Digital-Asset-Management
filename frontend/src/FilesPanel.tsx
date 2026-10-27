import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Upload } from "tus-js-client";
import { api, errorMessage, type Session } from "./api";
import { createTaskKey, digestUploadSample } from "./browserCrypto";
import { readBlobAsArrayBuffer } from "./browserCompat";

type Attachment = {
  id: number;
  filename: string;
  relativePath: string;
  size: number;
  uploader: string;
  updatedAt: string;
  kind: "project" | "demo";
  previewable: boolean;
};
type Task = {
  key: string;
  file: File;
  relativePath: string;
  attachmentId?: number;
  progress: number;
  status: "ready" | "uploading" | "paused" | "error" | "complete";
  error?: string;
};
export type SelectedFile = { file: File; relativePath: string };
export type FilesPanelHandle = { commit: () => Promise<void> };
type DroppedEntry = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
};
type DroppedFileEntry = DroppedEntry & {
  file: (
    success: (file: File) => void,
    failure?: (error: DOMException) => void,
  ) => void;
};
type DroppedDirectoryEntry = DroppedEntry & {
  createReader: () => {
    readEntries: (
      success: (entries: DroppedEntry[]) => void,
      failure?: (error: DOMException) => void,
    ) => void;
  };
};

async function readDirectory(entry: DroppedDirectoryEntry) {
  const reader = entry.createReader();
  const entries: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}

async function filesFromEntry(entry: DroppedEntry): Promise<SelectedFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as DroppedFileEntry).file(resolve, reject),
    );
    const parts = entry.fullPath.split("/").filter(Boolean);
    return [{ file, relativePath: parts.slice(0, -1).join("/") }];
  }
  if (!entry.isDirectory) return [];
  const children = await readDirectory(entry as DroppedDirectoryEntry);
  return (await Promise.all(children.map(filesFromEntry))).flat();
}

export async function filesFromDrop(
  data: DataTransfer,
): Promise<SelectedFile[]> {
  const entries = Array.from(data.items)
    .map((item): DroppedEntry | null => {
      const getEntry = (
        item as unknown as {
          webkitGetAsEntry?: () => DroppedEntry | null;
        }
      ).webkitGetAsEntry;
      return getEntry ? getEntry.call(item) : null;
    })
    .filter((entry): entry is DroppedEntry => Boolean(entry));
  if (entries.length)
    return (await Promise.all(entries.map(filesFromEntry))).flat();
  return Array.from(data.files).map((file) => ({ file, relativePath: "" }));
}

export function filesFromList(files: FileList | null): SelectedFile[] {
  return Array.from(files ?? []).map((file) => {
    const parts = file.webkitRelativePath.split("/").filter(Boolean);
    return { file, relativePath: parts.slice(0, -1).join("/") };
  });
}

const shownPath = (item: { filename: string; relativePath: string }) =>
  item.relativePath ? `${item.relativePath}/${item.filename}` : item.filename;
export const MAX_FILE_SIZE = 5_000_000_000;
const size = (n: number) =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + " GB"
    : n >= 1e6
      ? (n / 1e6).toFixed(1) + " MB"
      : n >= 1000
        ? (n / 1000).toFixed(1) + " KB"
        : n + " B";

type FileTreeNode = {
  name: string;
  path: string;
  folders: Map<string, FileTreeNode>;
  files: TreeFile[];
};

type TreeFile = {
  key: string;
  filename: string;
  relativePath: string;
  size: number;
  attachment?: Attachment;
  task?: Task;
};

function buildFileTree(files: Attachment[], tasks: Task[]) {
  const root: FileTreeNode = {
    name: "",
    path: "",
    folders: new Map(),
    files: [],
  };
  const items: TreeFile[] = [
    ...files.map((file) => ({
      key: `file-${file.id}`,
      filename: file.filename,
      relativePath: file.relativePath,
      size: file.size,
      attachment: file,
    })),
    ...tasks.map((task) => ({
      key: `task-${task.key}`,
      filename: task.file.name,
      relativePath: task.relativePath,
      size: task.file.size,
      task,
    })),
  ];
  for (const file of items) {
    let node = root;
    for (const part of file.relativePath.split("/").filter(Boolean)) {
      let folder = node.folders.get(part);
      if (!folder) {
        folder = {
          name: part,
          path: node.path ? `${node.path}/${part}` : part,
          folders: new Map(),
          files: [],
        };
        node.folders.set(part, folder);
      }
      node = folder;
    }
    node.files.push(file);
  }
  return root;
}

function fileCount(node: FileTreeNode): number {
  let count = node.files.length;
  for (const folder of node.folders.values()) count += fileCount(folder);
  return count;
}

function filesIn(node: FileTreeNode): TreeFile[] {
  const files = [...node.files];
  for (const folder of node.folders.values()) files.push(...filesIn(folder));
  return files;
}

function fileType(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 && dot < filename.length - 1
    ? filename.slice(dot + 1).toUpperCase()
    : "文件";
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M3.75 6.75h6l1.8 2.25h8.7v8.25H3.75V6.75Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M6.75 3.75h7.5l3 3v13.5H6.75V3.75Z" />
      <path d="M14.25 3.75v3h3" />
    </svg>
  );
}

function demoMediaType(filename: string) {
  const extension = filename.toLowerCase().split(".").pop();
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension ?? ""))
    return "image";
  if (extension === "mp4") return "video";
  if (extension === "pdf") return "pdf";
  return "unsupported";
}

function DemoShowcase({ files }: { files: Attachment[] }) {
  return (
    <div className="demo-showcase">
      {files.map((file) => {
        const mediaType = demoMediaType(file.filename);
        const previewURL = `/api/v1/files/${file.id}/preview`;
        return (
          <figure
            className={`demo-showcase-item is-${mediaType}`}
            key={file.id}
          >
            <div className="demo-showcase-media">
              {mediaType === "image" ? (
                <img src={previewURL} alt={file.filename} loading="lazy" />
              ) : mediaType === "video" ? (
                <video
                  src={previewURL}
                  aria-label={file.filename}
                  controls
                  preload="metadata"
                >
                  当前浏览器无法播放此视频。
                </video>
              ) : mediaType === "pdf" ? (
                <iframe title={file.filename} src={previewURL} />
              ) : (
                <div className="demo-showcase-unsupported">
                  <FileIcon />
                  <span>此格式暂不支持在线展示</span>
                </div>
              )}
            </div>
            <figcaption>
              <strong>{shownPath(file)}</strong>
              <span>
                {fileType(file.filename)} · {size(file.size)} · {file.uploader}
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function FileTree({
  node,
  projectId,
  demo,
  editable,
  active,
  deletingId,
  pendingDeleteIds,
  onPreview,
  onRemove,
  onRemoveFolder,
  onPause,
  nested = false,
}: {
  node: FileTreeNode;
  projectId: number;
  demo: boolean;
  editable: boolean;
  active: boolean;
  deletingId: number;
  pendingDeleteIds: Set<number>;
  onPreview: (file: Attachment) => void;
  onRemove: (file: TreeFile) => void;
  onRemoveFolder: (files: TreeFile[]) => void;
  onPause: (task: Task) => void;
  nested?: boolean;
}) {
  const folders = Array.from(node.folders.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
  );
  const files = [...node.files].sort((a, b) =>
    a.filename.localeCompare(b.filename, "zh-CN", { numeric: true }),
  );
  return (
    <ul className={nested ? "file-tree-branch" : "file-tree"}>
      {folders.map((folder) => (
        <li className="file-tree-folder" key={folder.name}>
          <details>
            <summary>
              <span className="file-tree-folder-name">
                <FolderIcon />
                <span className="file-tree-folder-copy">
                  <strong>{folder.name}</strong>
                  <small>{fileCount(folder)} 个文件</small>
                </span>
              </span>
              <span className="file-tree-folder-actions">
                {!demo && filesIn(folder).some((file) => file.attachment) && (
                  <a
                    href={`/api/v1/projects/${projectId}/files/download-folder?folder=${encodeURIComponent(folder.path)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    下载
                  </a>
                )}
                {editable && (
                  <button
                    type="button"
                    className={`text-button${filesIn(folder).every((file) => file.attachment && pendingDeleteIds.has(file.attachment.id)) ? "" : " danger-text"}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemoveFolder(filesIn(folder));
                    }}
                  >
                    {filesIn(folder).every(
                      (file) =>
                        file.attachment &&
                        pendingDeleteIds.has(file.attachment.id),
                    )
                      ? "撤销删除文件夹"
                      : filesIn(folder).some((file) => file.task)
                        ? "移除文件夹"
                        : "删除文件夹"}
                  </button>
                )}
              </span>
            </summary>
            <FileTree
              node={folder}
              projectId={projectId}
              demo={demo}
              editable={editable}
              active={active}
              deletingId={deletingId}
              pendingDeleteIds={pendingDeleteIds}
              onPreview={onPreview}
              onRemove={onRemove}
              onRemoveFolder={onRemoveFolder}
              onPause={onPause}
              nested
            />
          </details>
        </li>
      ))}
      {files.map((file) => (
        <li
          className={`file-tree-file${file.attachment && pendingDeleteIds.has(file.attachment.id) ? " is-pending-delete" : ""}${file.task ? " is-pending-add" : ""}`}
          key={file.key}
        >
          <div className="file-tree-name">
            <FileIcon />
            <div>
              <strong>{file.filename}</strong>
              <span className="file-tree-meta">
                <span className="file-type">{fileType(file.filename)}</span>
                <span>{size(file.size)}</span>
                {file.attachment ? (
                  <>
                    <span>{file.attachment.uploader}</span>
                    <time dateTime={file.attachment.updatedAt}>
                      {new Date(file.attachment.updatedAt).toLocaleString(
                        "zh-CN",
                        {
                          timeZone: "Asia/Shanghai",
                          hour12: false,
                        },
                      )}
                    </time>
                  </>
                ) : (
                  <span className="pending-add-state">
                    {file.task?.status === "uploading"
                      ? `正在保存 ${file.task.progress}%`
                      : file.task?.status === "error"
                        ? "保存失败，再次保存可重试"
                        : file.task?.status === "paused"
                          ? "已暂停，再次保存可继续"
                          : "待保存"}
                  </span>
                )}
                {file.attachment &&
                  pendingDeleteIds.has(file.attachment.id) && (
                    <span className="pending-file-state">待删除</span>
                  )}
              </span>
              {file.task && file.task.status !== "ready" && (
                <progress value={file.task.progress} max={100} />
              )}
              {file.task?.error && (
                <small className="error">{file.task.error}</small>
              )}
            </div>
          </div>
          <div className="file-tree-actions">
            {file.attachment && !demo && (
              <a href={`/api/v1/files/${file.attachment.id}/download`}>下载</a>
            )}
            {demo && file.attachment?.previewable && (
              <button
                className="text-button"
                onClick={() => onPreview(file.attachment!)}
              >
                预览
              </button>
            )}
            {editable && (
              <button
                className={`text-button${file.attachment && !pendingDeleteIds.has(file.attachment.id) ? " danger-text" : ""}`}
                disabled={
                  (Boolean(file.attachment) && active) ||
                  deletingId === file.attachment?.id
                }
                onClick={() =>
                  file.task?.status === "uploading"
                    ? onPause(file.task)
                    : onRemove(file)
                }
              >
                {file.task?.status === "uploading"
                  ? "暂停"
                  : deletingId === file.attachment?.id
                    ? "正在删除…"
                    : file.attachment &&
                        pendingDeleteIds.has(file.attachment.id)
                      ? "撤销删除"
                      : file.task
                        ? "移除"
                        : "删除文件"}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PendingFileTree({
  files,
  onRemove,
  onRemoveFolder,
}: {
  files: SelectedFile[];
  onRemove: (file: SelectedFile) => void;
  onRemoveFolder: (files: SelectedFile[]) => void;
}) {
  const tasks: Task[] = files.map((item, index) => ({
    key: `pending-${index}-${item.relativePath}-${item.file.name}`,
    file: item.file,
    relativePath: item.relativePath,
    progress: 0,
    status: "ready",
  }));
  if (!tasks.length) return null;
  return (
    <FileTree
      node={buildFileTree([], tasks)}
      projectId={0}
      demo={false}
      editable
      active={false}
      deletingId={0}
      pendingDeleteIds={new Set()}
      onPreview={() => undefined}
      onRemove={(item) => {
        if (item.task)
          onRemove({
            file: item.task.file,
            relativePath: item.task.relativePath,
          });
      }}
      onRemoveFolder={(items) =>
        onRemoveFolder(
          items.flatMap((item) =>
            item.task
              ? [
                  {
                    file: item.task.file,
                    relativePath: item.task.relativePath,
                  },
                ]
              : [],
          ),
        )
      }
      onPause={() => undefined}
    />
  );
}

export const FilesPanel = forwardRef<
  FilesPanelHandle,
  {
    projectId: number;
    session: Session;
    initialFiles?: SelectedFile[];
    onSaved?: () => void;
    onPendingChange?: (pending: boolean) => void;
    kind?: "project" | "demo";
    editable?: boolean;
    deferInitialLoad?: boolean;
    headerAction?: ReactNode;
  }
>(function FilesPanel(
  {
    projectId,
    session,
    initialFiles = [],
    onSaved,
    onPendingChange,
    kind = "project",
    editable = false,
    deferInitialLoad = false,
    headerAction,
  },
  ref,
) {
  const [files, setFiles] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!deferInitialLoad);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [deletingId, setDeletingId] = useState(0);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [dragging, setDragging] = useState(false);
  const [tasks, setTasks] = useState<Task[]>(() =>
    initialFiles.map(({ file, relativePath }) => ({
      key: createTaskKey(),
      file,
      relativePath,
      progress: 0,
      status: "ready",
    })),
  );
  const uploads = useRef(new Map<string, Upload>()),
    starting = useRef(new Set<string>()),
    uploadRejecters = useRef(new Map<string, (reason: Error) => void>()),
    picker = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  const active = tasks.some((t) => t.status === "uploading");
  function update(key: string, changes: Partial<Task>) {
    if (alive.current)
      setTasks((ts) =>
        ts.map((t) => (t.key === key ? { ...t, ...changes } : t)),
      );
  }
  async function refresh() {
    try {
      const r = await api<{ items: Attachment[] }>(
        `/projects/${projectId}/${kind === "demo" ? "demo-files" : "files"}`,
      );
      if (alive.current) {
        setFiles(r.items);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    if (!deferInitialLoad) void refresh();
    return () => {
      alive.current = false;
      for (const upload of uploads.current.values()) void upload.abort();
    };
    // This flag describes the state when the panel is mounted. A deferred
    // panel is refreshed by commit() after the project setting is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    if (active) window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  useEffect(() => {
    onPendingChange?.(tasks.length > 0 || pendingDeleteIds.size > 0);
  }, [onPendingChange, pendingDeleteIds, tasks.length]);
  function enqueue(selected: SelectedFile[]) {
    const invalid = selected.find(({ file }) => file.size > MAX_FILE_SIZE);
    if (invalid) {
      setError(
        `${shownPath({ filename: invalid.file.name, relativePath: invalid.relativePath })} 超过单文件 5 GB 上限。`,
      );
      return;
    }
    setError("");
    setTasks((ts) => [
      ...ts,
      ...selected.map(({ file, relativePath }) => ({
        key: createTaskKey(),
        file,
        relativePath,
        progress: 0,
        status: "ready" as const,
      })),
    ]);
  }
  function pick(e: ChangeEvent<HTMLInputElement>) {
    const selected = filesFromList(e.target.files);
    e.target.value = "";
    enqueue(selected);
  }
  async function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    try {
      enqueue(await filesFromDrop(e.dataTransfer));
    } catch {
      setError("无法读取拖入的文件夹，请重新拖入或逐个选择文件。");
    }
  }
  function start(task: Task): Promise<void> {
    if (starting.current.has(task.key))
      return Promise.reject(new Error("文件正在上传"));
    return new Promise((resolve, reject) => {
      starting.current.add(task.key);
      uploadRejecters.current.set(task.key, reject);
      update(task.key, { status: "uploading", error: "" });
      const finish = () => {
        starting.current.delete(task.key);
        uploadRejecters.current.delete(task.key);
        uploads.current.delete(task.key);
      };
      const fail = (reason: unknown) => {
        const message = errorMessage(reason);
        finish();
        update(task.key, { status: "error", error: message });
        reject(reason instanceof Error ? reason : new Error(message));
      };
      const upload = new Upload(task.file, {
        endpoint: "/api/v1/uploads",
        chunkSize: 8 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        removeFingerprintOnSuccess: false,
        metadata: {
          filename: task.file.name,
          projectId: String(projectId),
          kind,
          relativePath: task.relativePath,
        },
        headers: { "X-CSRF-Token": session.csrfToken },
        fingerprint: async (file) => {
          const f = file as File;
          const bytes = await readBlobAsArrayBuffer(
            new Blob([f.slice(0, 65536), f.slice(Math.max(0, f.size - 65536))]),
          );
          const digest = await digestUploadSample(bytes);
          return [
            "assets",
            location.origin,
            session.user.id,
            projectId,
            kind,
            task.relativePath,
            f.name,
            f.size,
            f.lastModified,
            digest,
          ].join(":");
        },
        onProgress: (sent, total) =>
          update(task.key, {
            progress: total ? Math.round((sent / total) * 100) : 100,
          }),
        onError: () =>
          fail(new Error("上传未完成，请确认网络与登录状态后重试。")),
        onSuccess: async () => {
          try {
            const id = upload.url?.split("/").pop();
            const saved = await api<Attachment>(
              "/uploads/" + id + "/complete",
              { method: "POST" },
              session.csrfToken,
            );
            update(task.key, {
              status: "complete",
              progress: 100,
              attachmentId: saved.id,
            });
            try {
              const previous = await upload.findPreviousUploads();
              for (const entry of previous) {
                if (entry.uploadUrl === upload.url)
                  await upload.options.urlStorage?.removeUpload(
                    entry.urlStorageKey,
                  );
              }
            } catch {
              /* Saved file remains valid if local resume-cache cleanup fails. */
            }
            finish();
            if (alive.current)
              setTasks((items) =>
                items.filter((item) => item.key !== task.key),
              );
            resolve();
          } catch (reason) {
            fail(reason);
          }
        },
      });
      uploads.current.set(task.key, upload);
      void upload
        .findPreviousUploads()
        .then((previous) => {
          if (!alive.current) throw new Error("页面已关闭，上传已取消。");
          if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        })
        .catch(fail);
    });
  }
  async function pause(task: Task) {
    await uploads.current.get(task.key)?.abort();
    starting.current.delete(task.key);
    update(task.key, { status: "paused" });
    uploadRejecters.current.get(task.key)?.(
      new Error("上传已暂停，再次保存可继续上传。"),
    );
    uploadRejecters.current.delete(task.key);
  }
  function remove(file: TreeFile) {
    if (file.task) {
      setTasks((items) => items.filter((item) => item.key !== file.task?.key));
      return;
    }
    if (!file.attachment) return;
    setPendingDeleteIds((current) => {
      const next = new Set(current);
      if (next.has(file.attachment!.id)) next.delete(file.attachment!.id);
      else next.add(file.attachment!.id);
      return next;
    });
    if (preview?.id === file.attachment.id) setPreview(null);
  }
  function removeFolder(folderFiles: TreeFile[]) {
    const taskKeys = new Set(
      folderFiles.flatMap((file) => (file.task ? [file.task.key] : [])),
    );
    if (taskKeys.size)
      setTasks((items) => items.filter((item) => !taskKeys.has(item.key)));
    const ids = folderFiles.flatMap((file) =>
      file.attachment ? [file.attachment.id] : [],
    );
    if (!ids.length) return;
    setPendingDeleteIds((current) => {
      const next = new Set(current);
      const undo = ids.every((id) => next.has(id));
      for (const id of ids) undo ? next.delete(id) : next.add(id);
      return next;
    });
    if (preview && ids.includes(preview.id)) setPreview(null);
  }
  useImperativeHandle(ref, () => ({
    commit: async () => {
      setError("");
      try {
        for (const task of tasks) await start(task);
        for (const id of pendingDeleteIds) {
          setDeletingId(id);
          await api(`/files/${id}`, { method: "DELETE" }, session.csrfToken);
        }
        setPendingDeleteIds(new Set());
        await refresh();
        onSaved?.();
      } catch (reason) {
        setError(errorMessage(reason));
        throw reason;
      } finally {
        setDeletingId(0);
      }
    },
  }));
  const demo = kind === "demo";
  const previewURL = preview ? `/api/v1/files/${preview.id}/preview` : "";
  const previewType = preview?.filename.toLowerCase().endsWith(".pdf")
    ? "pdf"
    : preview?.filename.toLowerCase().endsWith(".mp4")
      ? "video"
      : "image";
  return (
    <section
      className={`readme-panel files-panel${editable ? " files-panel-editable" : ""}`}
    >
      <div className="editor-title">
        <h2>{demo ? "演示材料" : "项目文件"}</h2>
        {((!demo && files.length > 0) || headerAction) && (
          <div className="editor-actions">
            {!demo && files.length > 0 && (
              <a
                className="button-link"
                href={`/api/v1/projects/${projectId}/files/download-all`}
              >
                全部下载
              </a>
            )}
            {headerAction}
          </div>
        )}
      </div>
      {editable && (
        <div
          className={`file-drop-zone${dragging ? " is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }}
          onDragLeave={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !event.currentTarget.contains(next))
              setDragging(false);
          }}
          onDrop={(event) => void drop(event)}
        >
          <div className="file-drop-copy">
            <strong>拖入文件或整个文件夹</strong>
            <span>程序自动识别并保留文件夹结构；空文件夹不会上传。</span>
          </div>
          <button type="button" onClick={() => picker.current?.click()}>
            {demo ? "添加演示材料" : "添加文件"}
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            aria-label={demo ? "选择演示材料" : "选择项目文件"}
            onChange={pick}
          />
        </div>
      )}
      <p className="hint">
        {demo
          ? editable
            ? "选择或拖入后进入待保存列表，点击顶部“保存修改”后上传。图片、PDF、MP4 可在线预览，单文件最大 5 GB。"
            : "图片、视频和 PDF 直接展示；其他格式仅显示文件信息，不提供下载。"
          : editable
            ? "选择或拖入后只暂存于当前页面，点击顶部“保存修改”才会上传；删除操作也在保存后生效。"
            : "下载项目原始文件；需要添加或删除文件时，请进入编辑项目。"}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          <button onClick={() => void refresh()}>刷新列表</button>
        </p>
      )}
      {loading ? (
        <p role="status">正在读取附件…</p>
      ) : demo && !editable && files.length ? (
        <DemoShowcase files={files} />
      ) : files.length || tasks.length ? (
        <FileTree
          node={buildFileTree(files, tasks)}
          projectId={projectId}
          demo={demo}
          editable={editable}
          active={active}
          deletingId={deletingId}
          pendingDeleteIds={pendingDeleteIds}
          onPreview={setPreview}
          onRemove={(file) => void remove(file)}
          onRemoveFolder={removeFolder}
          onPause={(task) => void pause(task)}
        />
      ) : (
        <p className="muted">
          {demo
            ? editable
              ? "暂无演示材料，可添加图片、PDF、MP4、演示文稿或其他文件。"
              : "暂无演示材料。"
            : editable
              ? "暂无项目文件，可添加 ZIP、文档、图片或其他原始文件。"
              : "暂无项目文件。"}
        </p>
      )}
      {demo && preview && (
        <div className="file-preview">
          <div className="file-preview-title">
            <strong>{shownPath(preview)}</strong>
            <button className="text-button" onClick={() => setPreview(null)}>
              关闭预览
            </button>
          </div>
          {previewType === "pdf" ? (
            <iframe title={`预览 ${preview.filename}`} src={previewURL} />
          ) : previewType === "video" ? (
            <video controls src={previewURL}>
              当前浏览器无法播放此视频。
            </video>
          ) : (
            <img src={previewURL} alt={preview.filename} />
          )}
        </div>
      )}
    </section>
  );
});
