export type ContentDispositionType = "attachment" | "inline";

const HEADER_FILENAME_FALLBACK = "file";

function normalizeFilenameForHeader(fileName: string): string {
  const baseName = fileName.split(/[/\\]/).filter(Boolean).at(-1) ?? "";
  const sanitized = baseName.replace(/["\\\r\n]/g, "_").trim();

  return sanitized || HEADER_FILENAME_FALLBACK;
}

function toAsciiHeaderFilename(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_");
  const compacted = ascii.replace(/\s+/g, " ").trim();

  return compacted || HEADER_FILENAME_FALLBACK;
}

export function buildContentDispositionHeader(
  fileName: string,
  disposition: ContentDispositionType = "attachment",
): string {
  const normalized = normalizeFilenameForHeader(fileName);
  const asciiFallback = toAsciiHeaderFilename(normalized);
  const encoded = encodeURIComponent(normalized);

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
