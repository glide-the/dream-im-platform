// [Input] Authenticated Provider read/write requests and strict revision-fenced network mutations.
// [Output] Safe configuration projection and atomic PostgreSQL setting/audit updates.
// [Pos] Model-network Admin boundary; never starts Docker or modifies host proxy services.
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { ModelEgressError, modelEgressProxyUrl, readModelEgressPolicy } from "../model-egress";
import { modelEgressMutationSchema, modelEgressSetting } from "../model-egress-policy";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, assertAdminMutationOrigin, requireAdminRequest } from "./guard";

function errorResponse(error: unknown, requestId: string) {
  return adminErrorResponse(error instanceof ModelEgressError ? new AdminError(error.code, error.message, 503) : error, requestId);
}
export async function handleModelEgressGet(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "providers.read");
    return Response.json({ data: await withPlatformClient(readModelEgressPolicy) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error, requestId); }
}
export async function handleModelEgressPatch(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const parsed = modelEgressMutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AdminError("MODEL_EGRESS_INPUT_INVALID", "代理设置无效，请刷新页面后重试", 400);
    if (parsed.data.enabled && !modelEgressProxyUrl()) throw new AdminError("MODEL_EGRESS_PROXY_UNAVAILABLE", "尚未配置本机 Docker NAT 代理，请联系运维配置", 503);
    const data = await withPlatformTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${modelEgressSetting.category}.${modelEgressSetting.key}`]);
      const before = await readModelEgressPolicy(client);
      if (parsed.data.expectedRevision !== before.revision) throw new AdminError("MODEL_EGRESS_REVISION_CONFLICT", "代理设置已被其他管理员修改，请刷新后重试", 409);
      if (before.revision === Number.MAX_SAFE_INTEGER) throw new AdminError("MODEL_EGRESS_REVISION_EXHAUSTED", "代理设置版本无法继续更新", 409);
      const stored = { revision: (before.revision ?? 0) + 1, enabled: parsed.data.enabled };
      await client.query(
        `INSERT INTO system_settings (id, category, key, value, description, is_secret, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, FALSE, 'active', NOW(), NOW())
         ON CONFLICT (category, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [createPlatformId("setting"), modelEgressSetting.category, modelEgressSetting.key, JSON.stringify(stored), "模型中心本机 Docker NAT 代理开关"],
      );
      await recordAdminAuditOnClient(client, { identity, action: "update", resourceType: "model_egress_policy",
        resourceId: `${modelEgressSetting.category}.${modelEgressSetting.key}`, requestId, request,
        before: { enabled: before.desiredEnabled, revision: before.revision }, after: stored });
      return readModelEgressPolicy(client);
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error, requestId); }
}
