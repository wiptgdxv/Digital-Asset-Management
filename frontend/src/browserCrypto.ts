function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

// randomUUID is unavailable in older browsers and in some non-secure HTTP
// contexts. These IDs only identify local upload tasks; they are not secrets.
export function createTaskKey() {
  const browserCrypto = window.crypto;
  if (typeof browserCrypto?.randomUUID === "function")
    return browserCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof browserCrypto?.getRandomValues === "function") {
    browserCrypto.getRandomValues(bytes);
  } else {
    const seed = `${Date.now()}-${performance.now()}-${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] =
        seed.charCodeAt(index % seed.length) ^
        Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = hex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function fallbackDigest(bytes: Uint8Array) {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < bytes.length; index += 1) {
    for (let lane = 0; lane < hashes.length; lane += 1) {
      hashes[lane] = Math.imul(
        hashes[lane] ^ ((bytes[index] + index + lane * 31) & 0xff),
        0x01000193 + lane * 2,
      );
    }
  }
  return hashes.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

// Web Crypto digest is also restricted in some HTTP/older-browser contexts.
// The deterministic fallback is sufficient for a resumable-upload fingerprint;
// server-side integrity and authorization do not rely on this value.
export async function digestUploadSample(buffer: ArrayBuffer) {
  const subtle = window.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      return hex(new Uint8Array(await subtle.digest("SHA-256", buffer)));
    } catch {
      // Fall through when a browser exposes subtle but blocks it in this context.
    }
  }
  return fallbackDigest(new Uint8Array(buffer));
}
