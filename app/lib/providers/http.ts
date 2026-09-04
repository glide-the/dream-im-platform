// [Input] Injected fetch implementation and bounded provider HTTP responses.
// [Output] Bounded JSON containers and status-only errors that never include response bodies or credentials.
// [Pos] Shared transport parsing and HTTP error classification for provider adapters.
// [Sync] 2026-09-04: isolate the larger model-catalog byte budget from sensitive OAuth responses.

import { ProviderProtocolError } from "./errors";

const MAX_RESPONSE_BYTES = 64 * 1024;
export const MAX_MODEL_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;

export type JsonRecord = Record<string, unknown>;
export type JsonContainer = JsonRecord | unknown[];

type ReadJsonOptions = Readonly<{ maxBytes?: number }>;

function responseByteLimit(options?: ReadJsonOptions) {
  const maxBytes = options?.maxBytes ?? MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || maxBytes > MAX_MODEL_CATALOG_RESPONSE_BYTES
  ) {
    throw new ProviderProtocolError({
      code: "PROVIDER_RESPONSE_LIMIT_INVALID",
      category: "protocol",
      message: "The provider response limit is invalid",
    });
  }
  return maxBytes;
}

export async function readJsonValue(
  response: Response,
  options?: ReadJsonOptions,
): Promise<JsonContainer> {
  const maxBytes = responseByteLimit(options);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProviderProtocolError({
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      category: "protocol",
      message: "The provider response exceeded the allowed size",
      httpStatus: response.status,
    });
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderProtocolError({
          code: "PROVIDER_RESPONSE_TOO_LARGE",
          category: "protocol",
          message: "The provider response exceeded the allowed size",
          httpStatus: response.status,
        });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    const value: unknown = text === "" ? {} : JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error();
    return value as JsonContainer;
  } catch {
    throw new ProviderProtocolError({
      code: "PROVIDER_RESPONSE_INVALID",
      category: "protocol",
      message: "The provider returned an invalid response",
      httpStatus: response.status,
    });
  }
}

export async function readJsonRecord(
  response: Response,
  options?: ReadJsonOptions,
): Promise<JsonRecord> {
  const value = await readJsonValue(response, options);
  if (Array.isArray(value)) {
    throw new ProviderProtocolError({
      code: "PROVIDER_RESPONSE_INVALID",
      category: "protocol",
      message: "The provider returned an invalid response",
      httpStatus: response.status,
    });
  }
  return value;
}

export function throwForHttpStatus(response: Response, code = "PROVIDER_HTTP_ERROR"): never {
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  throw new ProviderProtocolError({
    code,
    category: response.status === 401 || response.status === 403 ? "authorization" : "network",
    message: "The provider rejected the request",
    retryable,
    httpStatus: response.status,
  });
}

export function requiredString(value: unknown, fieldCode: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProviderProtocolError({
      code: fieldCode,
      category: "protocol",
      message: "The provider response is missing a required field",
    });
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function positiveNumber(value: unknown, fallback?: number): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) return parsed;
  if (fallback !== undefined) return fallback;
  throw new ProviderProtocolError({
    code: "PROVIDER_RESPONSE_FIELD_INVALID",
    category: "protocol",
    message: "The provider response contains an invalid numeric field",
  });
}

export function oauthErrorCode(value: JsonRecord): string | undefined {
  return optionalString(value.error);
}
