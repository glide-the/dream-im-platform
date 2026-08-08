import type { PoolClient } from "pg";
import { createPlatformId } from "../platform-ids";
import type { AdminIdentity } from "./session";

function requestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}

export async function recordAdminAuditOnClient(
  client: PoolClient,
  input: {
    identity?: AdminIdentity;
    action: string;
    resourceType: string;
    resourceId?: string;
    requestId: string;
    request: Request;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO admin_audit_logs (
       id, actor_type, actor_id, action, resource_type, resource_id,
       request_id, ip_address, user_agent, before, after, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb
     )`,
    [
      createPlatformId("audit"),
      input.identity ? "admin" : "system",
      input.identity?.id ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.requestId,
      requestIp(input.request) ?? null,
      input.request.headers.get("user-agent")?.slice(0, 500) ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
