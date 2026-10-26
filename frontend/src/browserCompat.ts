export type CompatibleAbortController = {
  signal: AbortSignal | undefined;
  abort: () => void;
};

export function createCompatibleAbortController(): CompatibleAbortController {
  if (typeof AbortController !== "undefined") return new AbortController();
  return { signal: undefined, abort: () => undefined };
}

export function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("无法读取文件"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function readUtf8File(file: File) {
  if (typeof TextDecoder !== "undefined")
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await readBlobAsArrayBuffer(file),
    );
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file, "UTF-8");
  });
}

export async function copyText(text: string) {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // HTTP and older browsers may expose Clipboard but reject access.
    }
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("无法复制");
}
