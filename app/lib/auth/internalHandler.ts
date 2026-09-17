// [Input] Internal request with a confidential-client token and strict domain-specific DTO/schema handler.
// [Output] Stable data/error/request_id envelope without secret/body/SQL diagnostics.
// [Pos] Internal auth ingress orchestration shared by thin Route Handlers.
// [Sync] 2026-09-17: emit allowlisted database diagnostics for unexpected internal failures without logging bodies or secrets.
// [Sync] 2026-09-17: await OAuth client_credentials service authentication before domain dispatch.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthBoundaryError } from "./config";
import { requireDreamService } from "./serviceIdentity";
import type { DreamServiceClient } from "./config";
import { requestIdDto } from "./dto";
import { projectDomainErrorDetails } from "../dream/errorDto";

export async function parseAuthDto<T extends z.ZodType>(request: Request, schema: T, maximumBytes = Number(process.env.AUTH_MAX_BODY_BYTES ?? 16_384)): Promise<z.output<T>> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new AuthBoundaryError("JSON_REQUIRED", 415);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new AuthBoundaryError("AUTH_REQUEST_POLICY_INVALID");
  const reader = request.body?.getReader();
  if (!reader) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new AuthBoundaryError("INPUT_TOO_LARGE", 413); }
      chunks.push(next.value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = schema.safeParse(input);
    if (!result.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    return result.data;
  } catch (error) {
    if (error instanceof AuthBoundaryError) throw error;
    throw new AuthBoundaryError("INPUT_INVALID", 400);
  } finally { reader.releaseLock(); }
}

export async function handleInternalAuthRequest(request: Request, handler: (service: DreamServiceClient, setRequestId: (requestId: string) => void) => Promise<unknown>) {
  let requestId = requestIdDto.safeParse(request.headers.get("x-request-id")).data ?? `dream_${randomUUID().replaceAll("-", "")}`;
  const headers = { "Cache-Control": "no-store" };
  try {
    const data = await handler(await requireDreamService(request), value => { requestId = requestIdDto.parse(value); });
    return Response.json({ data, request_id: requestId }, { headers });
  } catch (error) {
    const code = error instanceof AuthBoundaryError ? error.code : "AUTH_SERVICE_UNAVAILABLE";
    const status = error instanceof AuthBoundaryError ? error.status : 503;
    if (!(error instanceof AuthBoundaryError)) {
      const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
      const postgresCode = typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code) ? record.code : null;
      const constraint = typeof record.constraint === "string" && /^[a-z0-9_]{1,128}$/.test(record.constraint)
        ? record.constraint : null;
      const stackFrames = error instanceof Error ? (error.stack ?? "").split("\n").slice(1, 6)
        .map(frame => frame.trim()).filter(frame => /^at [A-Za-z0-9_.$<>/:()\[\]\\ -]+$/.test(frame)) : [];
      console.error("Unexpected Admin internal operation failure", {
        request_id: requestId,
        error_name: error instanceof Error ? error.name : "UnknownError",
        postgres_code: postgresCode,
        constraint,
        stack_frames: stackFrames,
      });
    }
    const details = error instanceof AuthBoundaryError ? projectDomainErrorDetails(code, error.details) : undefined;
    return Response.json({ error: { code, message: status >= 500 ? "Service is unavailable." : "This request could not be completed.", ...(details === undefined ? {} : { details }) }, request_id: requestId }, { status, headers });
  }
}
