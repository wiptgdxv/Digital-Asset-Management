const MAX_DRAFT_AGE = 7 * 24 * 60 * 60 * 1000;

export type StoredDraft<T> = {
  value: T;
  savedAt: string;
};

export function readProjectDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(key) ?? "null",
    ) as StoredDraft<T> | null;
    if (!parsed || typeof parsed.savedAt !== "string" || !("value" in parsed))
      return null;
    const savedAt = new Date(parsed.savedAt).getTime();
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_DRAFT_AGE) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function writeProjectDraft<T>(key: string, value: T) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ value, savedAt: new Date().toISOString() }),
    );
  } catch {
    // A full or disabled browser storage area must not block editing.
  }
}

export function clearProjectDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
}

export function draftTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
