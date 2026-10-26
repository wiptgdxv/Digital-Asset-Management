export type User = {
  id: number;
  name: string;
  username: string;
  isAdmin: boolean;
};
export type Session = {
  user: User;
  csrfToken: string;
  mustChangePassword: boolean;
};
export type Project = {
  id: number;
  version: number;
  name: string;
  summary: string;
  readme: string;
  category: string;
  demoEnabled: boolean;
  author: User;
  lastEditor: User;
  collaborators: User[];
  createdAt: string;
  updatedAt: string;
};
export type Reply = {
  id: number;
  commentId: number;
  userId: number;
  user: User;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type Comment = {
  id: number;
  projectId: number;
  userId: number;
  user: User;
  content: string;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
};
export type CommentsResponse = { items: Comment[] };
export type Notification = {
  id: number;
  actor: User;
  projectId: number;
  projectName: string;
  commentId: number;
  content: string;
  isRead: boolean;
  createdAt: string;
};
export type NotificationsResponse = {
  items: Notification[];
  unread: number;
};
export type ProjectHistoryItem = {
  id: number;
  version: number;
  editor: User;
  action: "create" | "edit" | "restore" | "baseline";
  changedFields: string[];
  restoredFromVersion: number;
  createdAt: string;
};
export type ProjectHistoryResponse = {
  items: ProjectHistoryItem[];
  total: number;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  csrf?: string,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(response.status, body.message || "请求失败，请稍后重试");
  return body as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请稍后重试";
