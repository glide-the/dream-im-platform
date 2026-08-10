import { z } from "zod";

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 4_096;
const MAX_TOTAL_HEADER_LENGTH = 16_384;

const RESERVED_HEADERS = new Set([
  "api-key",
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-api-key",
]);

function looksSensitive(name: string) {
  return /(^|-)(api-key|credential|secret|token)($|-)/.test(name);
}

export const modelRequestHeadersSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, context) => {
    const entries = Object.entries(headers);
    if (entries.length > MAX_HEADER_COUNT) {
      context.addIssue({
        code: "custom",
        message: `requestHeaders must contain at most ${MAX_HEADER_COUNT} headers`,
      });
    }

    let totalLength = 0;
    const normalizedNames = new Set<string>();
    for (const [name, value] of entries) {
      const normalizedName = name.toLowerCase();
      totalLength += name.length + value.length;
      if (!HEADER_NAME_PATTERN.test(name)) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Header name contains invalid characters",
        });
      }
      if (
        RESERVED_HEADERS.has(normalizedName) ||
        looksSensitive(normalizedName) ||
        normalizedName.startsWith("sec-") ||
        normalizedName.startsWith("x-forwarded-")
      ) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Authentication, framing, forwarding, and content headers are managed by the gateway",
        });
      }
      if (normalizedNames.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Header names must be unique regardless of letter case",
        });
      }
      normalizedNames.add(normalizedName);
      if (value.length > MAX_HEADER_VALUE_LENGTH || /[\r\n\0]/.test(value)) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `Header value must be at most ${MAX_HEADER_VALUE_LENGTH} characters and contain no control line breaks`,
        });
      }
    }

    if (totalLength > MAX_TOTAL_HEADER_LENGTH) {
      context.addIssue({
        code: "custom",
        message: `Combined request headers must be at most ${MAX_TOTAL_HEADER_LENGTH} characters`,
      });
    }
  })
  .transform((headers) =>
    Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    ),
  );

export type ModelRequestHeaders = z.infer<typeof modelRequestHeadersSchema>;

export function applyModelRequestHeaders(
  target: Headers,
  configured: ModelRequestHeaders,
) {
  for (const [name, value] of Object.entries(configured)) {
    target.set(name, value);
  }
}
