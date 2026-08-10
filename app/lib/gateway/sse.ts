export type SseEvent = {
  event: string;
  data: string;
  raw: string;
};

function parseBlock(raw: string): SseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.replaceAll("\r\n", "\n").split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (!data.length) return undefined;
  return { event, data: data.join("\n"), raw };
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let rejectAborted: ((reason?: unknown) => void) | undefined;
  const aborted = signal
    ? new Promise<never>((_, reject) => { rejectAborted = reject; })
    : undefined;
  const onAbort = () => rejectAborted?.(
    signal?.reason ?? new DOMException("Aborted", "AbortError"),
  );
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = aborted
        ? await Promise.race([reader.read(), aborted])
        : await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(raw);
        if (event) yield event;
      }
      if (done) {
        completed = true;
        break;
      }
    }
    if (buffer.trim()) {
      const event = parseBlock(buffer);
      if (event) yield event;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!completed) {
      await reader.cancel(signal?.reason).catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export function serializeSse(input: {
  protocol: "anthropic" | "openai";
  data: unknown;
  eventType?: string;
}) {
  const rawData = typeof input.data === "string" ? input.data : JSON.stringify(input.data);
  const eventType = input.eventType ||
    (input.protocol === "anthropic" && input.data && typeof input.data === "object" && "type" in input.data
      ? String((input.data as { type: unknown }).type)
      : "message");
  const rawEvent = input.protocol === "anthropic"
    ? `event: ${eventType}\ndata: ${rawData}\n\n`
    : `data: ${rawData}\n\n`;
  return { eventType, rawData, rawEvent };
}
