import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { advanceDueSubscriptions } from "../../../../lib/subscriptions/period-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.strictObject({
  limit: z.number().int().min(1).max(500).optional(),
});

function workerSecret() {
  const secret = process.env.SUBSCRIPTION_PERIOD_WORKER_SECRET?.trim();
  return secret && Buffer.byteLength(secret) >= 32 ? secret : null;
}

function authorized(request: Request, expected: string) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const secret = workerSecret();
  if (!secret) {
    return Response.json(
      {
        error: {
          code: "SUBSCRIPTION_PERIOD_WORKER_NOT_CONFIGURED",
          message: "The subscription period worker is not configured",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!authorized(request, secret)) {
    return Response.json(
      {
        error: {
          code: "SUBSCRIPTION_PERIOD_WORKER_UNAUTHORIZED",
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
          code: "SUBSCRIPTION_PERIOD_WORKER_INPUT_INVALID",
          message: "The worker request is invalid",
          details: parsed.error.issues.slice(0, 8),
        },
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const advanced = await advanceDueSubscriptions({ limit: parsed.data.limit });
  return Response.json(
    {
      data: {
        processed: advanced.length,
        results: advanced,
      },
      meta: { processedAt: new Date().toISOString() },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
