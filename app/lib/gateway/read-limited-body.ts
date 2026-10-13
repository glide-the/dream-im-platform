// [Input] A web response/request byte stream, optional declared length, and an explicit technical byte limit.
// [Output] Fully read bytes or a stable limit exception after cancelling the stream.
// [Pos] Shared bounded in-memory reader for non-streaming Images bodies; it does not parse or persist content.
// [Sync] 2026-10-09: prevent undeclared chunked Image bodies from bypassing in-memory limits.
// [Sync] 2026-10-11: allow the Admin image verification deadline to cancel a pending read.

export class BodyLimitExceededError extends Error {
  constructor() {
    super("BODY_LIMIT_EXCEEDED");
    this.name = "BodyLimitExceededError";
  }
}

export async function readLimitedBody(input: {
  body: ReadableStream<Uint8Array> | null;
  declaredLength?: string | null;
  maxBytes: number;
  signal?: AbortSignal;
}) {
  const declared = input.declaredLength == null
    ? undefined
    : Number(input.declaredLength);
  if (
    declared !== undefined
    && (!Number.isSafeInteger(declared) || declared < 0)
  ) {
    throw new BodyLimitExceededError();
  }
  if (declared !== undefined && declared > input.maxBytes) {
    await input.body?.cancel().catch(() => undefined);
    throw new BodyLimitExceededError();
  }
  const reader = input.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAborted: ((reason: unknown) => void) | undefined;
  const aborted = input.signal ? new Promise<never>((_, reject) => { rejectAborted = reject; }) : undefined;
  const onAbort = () => rejectAborted?.(input.signal?.reason ?? new DOMException("Aborted", "AbortError"));
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = aborted ? await Promise.race([reader.read(), aborted]) : await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > input.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyLimitExceededError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (input.signal?.aborted) await reader.cancel(input.signal.reason).catch(() => undefined);
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
