import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { reconcileUnknownGatewayUsage } from "../../../../lib/gateway/settlement-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.strictObject({
  limit: z.number().int().min(1).max(500).optional(),
});

function configuration() {
  const secret = process.env.GATEWAY_SETTLEMENT_WORKER_SECRET?.trim();
  const rawGrace = process.env.GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS?.trim();
  const graceSeconds = rawGrace ? Number(rawGrace) : 900;
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    !Number.isSafeInteger(graceSeconds) ||
    graceSeconds < 60 ||
    graceSeconds > 604_800
  ) {
    return null;
  }
  return { secret, graceSeconds };
}

function authorized(request: Request, expected: string) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const configured = configuration();
  if (!configured) {
    return Response.json(
      {
        error: {
          code: "GATEWAY_SETTLEMENT_WORKER_NOT_CONFIGURED",
          message: "The Gateway settlement worker is not configured",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!authorized(request, configured.secret)) {
    return Response.json(
      {
        error: {
          code: "GATEWAY_SETTLEMENT_WORKER_UNAUTHORIZED",
          message: "Valid worker authorization is required",
        },
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "GATEWAY_SETTLEMENT_WORKER_INPUT_INVALID",
          message: "The worker request is invalid",
          details: parsed.error.issues.slice(0, 8),
        },
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const results = await reconcileUnknownGatewayUsage({
    graceSeconds: configured.graceSeconds,
    limit: parsed.data.limit,
  });
  return Response.json(
    {
      data: { processed: results.length, results },
      meta: { processedAt: new Date().toISOString() },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
