import { z } from "zod";

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
export const STORAGE_KEY_BASE64_PREFIX = "k64_";

export const StorageKeySegmentSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (segment) => segment !== "." && segment !== "..",
    "Storage key segment cannot be '.' or '..'",
  )
  .refine(
    (segment) => !segment.includes("/") && !segment.includes("\\"),
    "Storage key segment cannot contain path separators",
  )
  .refine(
    (segment) => !CONTROL_CHAR_PATTERN.test(segment),
    "Storage key segment cannot contain control characters",
  );

export const StorageKeySchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (key) => key.split("/").every((segment) => StorageKeySegmentSchema.safeParse(segment).success),
    "Invalid storage key",
  );

export function decodeStorageKeySegments(segments: string[]): string | null {
  const decoded: string[] = [];

  for (const segment of segments) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }

    if (!StorageKeySegmentSchema.safeParse(value).success) {
      return null;
    }
    decoded.push(value);
  }

  const key = decoded.join("/");
  return StorageKeySchema.safeParse(key).success ? key : null;
}

export function encodeStorageKeyForPath(key: string): string | null {
  const parsed = StorageKeySchema.safeParse(key);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.split("/").map(encodeURIComponent).join("/");
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(base64url: string): string {
  const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
  return normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
}

export function encodeStorageKeyToBase64Segment(key: string): string | null {
  const parsed = StorageKeySchema.safeParse(key);
  if (!parsed.success) {
    return null;
  }

  const utf8 = new TextEncoder().encode(parsed.data);
  const base64 = Buffer.from(utf8).toString("base64");
  return `${STORAGE_KEY_BASE64_PREFIX}${toBase64Url(base64)}`;
}

export function decodeStorageKeyFromBase64Segment(rawSegment: string): string | null {
  if (!rawSegment.startsWith(STORAGE_KEY_BASE64_PREFIX)) {
    return null;
  }

  const encoded = rawSegment.slice(STORAGE_KEY_BASE64_PREFIX.length);
  if (!encoded) {
    return null;
  }

  try {
    const utf8 = Buffer.from(fromBase64Url(encoded), "base64").toString("utf8");
    const parsed = StorageKeySchema.safeParse(utf8);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
