// [Input] Canonical assistant parts and optional completed-turn metadata.
// [Output] Strict v1 final-text/process projection or null when the row is ambiguous.
// [Pos] Pure shared contract used by the explicit Chat history projection backfill.
// [Sync] 2026-09-02: define the conservative projection rule without database or process side effects.

function objectValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function parseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function strictCompletedAssistantFinalIndex(parts) {
  if (!Array.isArray(parts)) return null;
  let lastProcessIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const part = objectValue(parts[index]);
    if (!part || !["text", "reasoning", "tool-invocation"].includes(part.type)) {
      return null;
    }
    if (part.type === "reasoning" || part.type === "tool-invocation") {
      lastProcessIndex = index;
    }
  }
  const finalIndex = lastProcessIndex + 1;
  if (parts.length - finalIndex !== 1) return null;
  const finalPart = objectValue(parts[finalIndex]);
  return finalPart?.type === "text"
    && typeof finalPart.text === "string"
    && finalPart.text.trim().length > 0
    ? finalIndex
    : null;
}

export function deriveChatHistoryFinalProjection(partsValue, metadataValue) {
  const parts = parseJson(partsValue);
  const metadata = objectValue(parseJson(metadataValue)) ?? {};
  if (!Array.isArray(parts) || metadata.is_partial === true) return null;
  const finalIndex = strictCompletedAssistantFinalIndex(parts);
  if (finalIndex === null) return null;
  const completionFields = [
    "turnId",
    "turnStatus",
    "finalPartIndex",
    "durationMs",
    "turnProjectionInvalid",
  ];
  const hasCompletionEnvelope = completionFields.some((key) => (
    Object.prototype.hasOwnProperty.call(metadata, key)
  ));
  if (hasCompletionEnvelope && (
    metadata.turnStatus !== "completed"
    || typeof metadata.turnId !== "string"
    || metadata.turnId.length === 0
    || !Number.isInteger(metadata.finalPartIndex)
    || metadata.finalPartIndex !== finalIndex
    || metadata.turnProjectionInvalid === true
  )) return null;
  return {
    finalText: parts[finalIndex].text,
    processAvailable: finalIndex > 0,
  };
}
