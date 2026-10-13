// [Input] Bound native selection and synthetic Provider/model/material state.
// [Output] Execution eligibility and source matching through the production preparation function.
// [Pos] Provider-free native image admission contract; not real model acceptance.
// [Sync] 2026-10-11: accept declared Codex operations and retain unsupported-provider and reservation failures.
// [Sync] 2026-10-11: exercise the real resolver's default snapshot and reject effective/altered routes.
import { beforeEach, expect, it, vi } from "vitest";
import type { GatewayPrincipal } from "./auth";
import type { ResolvedBillableModel } from "../models/resolver";
import { imageSelectionToolName } from "../dream/imageTurnDto";
import { operationInputDigest } from "../dream/receipts";
const mocks = vi.hoisted(() => ({ state: vi.fn(), query: vi.fn() }));
vi.mock("../platform-db", () => ({ withPlatformTransaction: async (action: (client: unknown) => unknown) => action({ query: mocks.query }) }));
vi.mock("./account-lock", () => ({ lockGatewayAccountOnClient: vi.fn() }));
vi.mock("./image-turn-receipts", () => ({ imageTurnContext: () => ({}), lockImageTurnOnClient: vi.fn(), readImageTurnOnClient: mocks.state, normalizeImageMaterialsOnClient: vi.fn() }));
vi.mock("./image-turn-materials", () => ({ currentImageMaterials: async () => ({ normalized: [], images: [] }), nativeImageConversationBody: (body: unknown) => body }));
import { prepareConversationImageTurn } from "./image-conversation-turn";
import { resolveBillableModel } from "../models/resolver";
const args = { operation: "native_generate", prompt: "One image", reference_images: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.state.mockResolvedValue({ binding: { ai_model: "ai_selected", image_model: "image_unrelated" }, claim: null,
    selection: { operation: "native_generate", source_call_id: "call_actual", reference_images: [], arguments_sha256: operationInputDigest(args) } });
});

it.each(["default", "ordered", "weighted", "fallback", "multiple", "snapshot_multiple", "excluded", "snapshot_provider", "snapshot_model", "execution_provider", "execution_model"])(
  "uses real model resolution and validates its %s native snapshot", async variant => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM platform_users")) return { rows: [{ id: "user", tier: "free", status: "active" }] };
      if (sql.includes("FROM ai_models AS m")) return { rows: [{ model_id: "model", model_code: "ai_selected", upstream_model: "upstream",
        display_name: "AI", capabilities: { chat: true, tools: true, responses_image_generation: true }, request_headers: {},
        image_output_token_reserve_per_image: 120000, provider_status: "active", provider_id: "provider", provider_code: "codex",
        protocol: "openai", adapter_kind: "codex", active_credential_kind: "managed_oauth", managed_credential_status: "connected",
        managed_credential_revision: 1, provider_config: {}, timeout_ms: 30000, max_retries: 0 }] };
      if (sql.includes("FROM user_model_permissions") || sql.includes("FROM ai_model_route_policies")) return { rows: [] };
      if (sql.includes("FROM ai_pricing_rules")) return { rows: [{ id: "pricing", input_price_microusd_per_million: 0,
        output_price_microusd_per_million: 0, cache_read_price_microusd_per_million: 0, cache_write_price_microusd_per_million: 0,
        image_input_price_microusd_per_million: null, image_output_price_microusd_per_million: null,
        markup_bps: 0, discount_bps: 0 }] };
      throw new Error("Unexpected resolver query");
    });
    const resolved = await resolveBillableModel({ platformUserId: "user", requestedModel: "ai_selected", protocol: "anthropic" });
    expect(resolved.routing).toMatchObject({ snapshot: { strategy: "default", allowFallbacks: false, excluded: [], candidates: [
      { providerId: "provider", upstreamModel: "upstream" }] }, candidates: [{ provider: { id: "provider" }, upstreamModel: "upstream" }] });
    const routing = resolved.routing!;
    if (variant === "ordered") routing.snapshot.strategy = "ordered";
    if (variant === "weighted") routing.snapshot.strategy = "weighted";
    if (variant === "fallback") routing.snapshot.allowFallbacks = true;
    if (variant === "multiple") routing.candidates.push(routing.candidates[0]);
    if (variant === "snapshot_multiple") routing.snapshot.candidates.push(routing.snapshot.candidates[0]);
    if (variant === "excluded") routing.snapshot.excluded.push({ providerId: "excluded", reason: "provider_disabled" });
    if (variant === "snapshot_provider") routing.snapshot.candidates[0].providerId = "other";
    if (variant === "snapshot_model") routing.snapshot.candidates[0].upstreamModel = "other";
    if (variant === "execution_provider") routing.candidates[0].provider = { ...routing.candidates[0].provider, id: "other" };
    if (variant === "execution_model") routing.candidates[0].upstreamModel = "other";
    const result = prepareConversationImageTurn({ principal: {} as GatewayPrincipal, resolved, turnKey: "bound_turn",
      body: { model: "ai_selected", messages: [{ role: "assistant", content: [
        { type: "tool_use", id: "call_actual", name: imageSelectionToolName, input: args }] }] } });
    if (variant === "default") expect((await result).native?.selection.operation).toBe("native_generate");
    else await expect(result).rejects.toMatchObject({ code: "AI_MODEL_IMAGE_OPERATION_UNAVAILABLE" });
  },
);
it.each([
  { adapterKind: "codex", config: {}, budget: 120000, capability: true, ok: true },
  { adapterKind: "generic", config: { openaiApi: "responses" }, budget: 120000, capability: true, ok: true },
  { adapterKind: "codex", config: {}, budget: 120000, capability: false, ok: false },
  { adapterKind: "xai", config: {}, budget: 120000, capability: true, ok: false },
  { adapterKind: "codex", config: {}, budget: null, capability: true, ok: false },
])("retains native execution admission for $adapterKind/$ok", async row => {
  const result = prepareConversationImageTurn({ principal: {} as GatewayPrincipal, turnKey: "bound_turn",
    resolved: { provider: { protocol: "openai", adapterKind: row.adapterKind, config: row.config },
      model: { capabilities: { chat: true, tools: true, responses_image_generation: row.capability, image_generation: true }, imageOutputTokenReservePerImage: row.budget } } as unknown as ResolvedBillableModel,
    body: { model: "ai_selected", tools: [{ name: imageSelectionToolName }], messages: [{ role: "assistant", content: [{ type: "tool_use", id: "call_actual", name: imageSelectionToolName, input: args }] }] } });
  if (row.ok) expect((await result).native?.selection.operation).toBe("native_generate");
  else await expect(result).rejects.toMatchObject({ code: "AI_MODEL_IMAGE_OPERATION_UNAVAILABLE" });
});
