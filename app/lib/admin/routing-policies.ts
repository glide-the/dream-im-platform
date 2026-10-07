// [Input] Admin Session, models.write, strict desired routing DTO and expected revision.
// [Output] Atomically validated same-model targets, effective revision and audit evidence.
// [Pos] Routing policy write boundary; route handlers only delegate.
import { withPlatformTransaction } from "../platform-db";
import { routingSaveSchema, targetSupportsModel, type RoutingModelCapability } from "../models/routing-policy";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, assertAdminMutationOrigin, requireAdminRequest } from "./guard";

export async function handleRoutingPolicySave(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "models.write");
    const parsed = routingSaveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AdminError("ROUTING_INPUT_INVALID", "请检查模型、候选和版本", 400);
    const input = parsed.data;
    const data = await withPlatformTransaction(async (client) => {
      const model = (await client.query<RoutingModelCapability & { id: string; protocol: string; adapter_kind: string }>(
        `SELECT m.id, m.capabilities, m.context_window, m.max_output_tokens, p.protocol, p.adapter_kind FROM ai_models m
         JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = $1 FOR UPDATE OF m`, [input.modelId],
      )).rows[0];
      if (!model) throw new AdminError("MODEL_NOT_FOUND", "模型不存在", 404);
      const before = (await client.query<Record<string, unknown> & { revision: number }>(
        "SELECT * FROM ai_model_route_policies WHERE model_id = $1 FOR UPDATE", [input.modelId],
      )).rows[0];
      if ((before?.revision ?? 0) !== input.expectedRevision) {
        throw new AdminError("ROUTING_REVISION_CONFLICT", "策略已更新，请重新读取后保存", 409);
      }
      const providers = (await client.query<{ id: string; protocol: string; adapter_kind: string; status: string }>(
        "SELECT id, protocol, adapter_kind, status FROM ai_providers WHERE id = ANY($1::text[]) FOR SHARE",
        [input.desired.targets.map((target) => target.providerId)],
      )).rows;
      const mappedModels = (await client.query<RoutingModelCapability & { provider_id: string; upstream_model: string }>(
        "SELECT provider_id, upstream_model, capabilities, context_window, max_output_tokens FROM ai_models WHERE enabled = TRUE AND provider_id = ANY($1::text[])",
        [input.desired.targets.map((target) => target.providerId)],
      )).rows;
      for (const target of input.desired.targets) {
        const provider = providers.find((value) => value.id === target.providerId);
        if (!provider || provider.status === "deleted" || provider.protocol !== model.protocol || provider.adapter_kind !== model.adapter_kind) {
          throw new AdminError("ROUTING_TARGET_INVALID", "候选必须存在，并与默认 Provider 的协议和产品类型相同", 400);
        }
        const mapped = mappedModels.find((value) => value.provider_id === target.providerId && value.upstream_model === target.upstreamModel);
        if (!mapped || !targetSupportsModel(model, mapped)) throw new AdminError("ROUTING_MODEL_CAPABILITY_INVALID", "候选上游型号须登记并启用，且能力、上下文和输出上限满足此模型", 400);

      }
      const effective = input.status === "active" ? input.desired : null;
      const revision = input.expectedRevision + 1;
      const after = (await client.query<Record<string, unknown>>(
        `INSERT INTO ai_model_route_policies (model_id, status, revision, desired, effective)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (model_id) DO UPDATE SET status = EXCLUDED.status, revision = EXCLUDED.revision,
           desired = EXCLUDED.desired, effective = EXCLUDED.effective, updated_at = NOW()
         RETURNING model_id AS id, model_id, status, revision, desired, effective, updated_at`,
        [input.modelId, input.status, revision, JSON.stringify(input.desired), effective ? JSON.stringify(effective) : null],
      )).rows[0];
      await client.query("DELETE FROM ai_model_route_targets WHERE model_id = $1", [input.modelId]);
      for (const [position, target] of input.desired.targets.entries()) {
        await client.query(`INSERT INTO ai_model_route_targets (model_id, provider_id, upstream_model, weight, position)
          VALUES ($1, $2, $3, $4, $5)`, [input.modelId, target.providerId, target.upstreamModel, target.weight, position]);
      }
      await recordAdminAuditOnClient(client, { identity, action: "save_routing_policy", resourceType: "routing-policies",
        resourceId: input.modelId, requestId, request, before, after });
      return after;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) { return adminErrorResponse(error, requestId); }
}
