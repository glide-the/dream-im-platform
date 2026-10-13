// [Sync] 2026-10-10: verify independent Image Settings and fail-closed native capability separation.
// [Sync] 2026-10-10: preserve existing allowance-only text eligibility while retaining independent Images authorization.
// [Input] Authenticated catalog queries plus synthetic Provider, pricing, subscription, and allowance rows.
// [Output] Regression proof for safe callability metadata and direct Provider-owned credential readiness SQL.
// [Pos] Focused unit contract for the public Gateway model catalog.
// [Sync] 2026-09-04: require managed readiness to follow the Provider pointer and credential owner.
// [Sync] 2026-10-09: cover endpoint-specific Images availability without regressing text callability.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), query: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("../platform-db", () => ({
  withPlatformClient: async (operation: (client: { query: typeof mocks.query }) => unknown) =>
    await operation({ query: mocks.query }),
}));

import {
  evaluateModelAvailability,
  handleGatewayModels,
  type ModelCatalogRow,
} from "./models";

const now = new Date("2030-01-15T00:00:00.000Z");
const baseRow: ModelCatalogRow = {
  code: "dream-balanced",
  display_name: "Dream Balanced",
  protocol: "anthropic",
  context_window: 200000,
  max_output_tokens: 8192,
  image_input_token_reserve_per_image: null,
  image_output_token_reserve_per_image: null,
  claude_code_auto_compact_window: 262144,
  claude_code_max_context_tokens: 262144,
  capabilities: { tools: true },
  provider_ready: true,
  pricing_ready: true,
  image_pricing_ready: false,
  image_provider_ready: false,
  messages_entitled: true,
  chat_entitled: false,
  images_entitled: false,
  subscription_id: "sub_1",
  subscription_status: "active",
  current_period_start: new Date("2030-01-01T00:00:00.000Z"),
  current_period_end: new Date("2030-02-01T00:00:00.000Z"),
  trial_ends_at: null,
  grace_ends_at: null,
  version_ready: true,
  entitlement_id: "ent_1",
  entitlement_is_default: true,
  permission_enabled: null,
  allowance_id: "allow_1",
  remaining_tokens: "1000",
  required_plan_code: "free",
};

describe("public Gateway model catalog", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset();
    mocks.query.mockReset();
    mocks.authenticate.mockResolvedValue({
      platformUserId: "platform-user-1",
      tier: "member",
    });
    mocks.query.mockImplementation(async (statement) => ({
      rows: String(statement).includes("drizzle.schema_capabilities")
        ? [{
            version: 1,
            contract_sha256: "7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d",
          }]
        : [baseRow],
    }));
  });

  it("returns every enabled model with safe callability metadata", async () => {
    mocks.query.mockImplementation(async (statement) => ({
      rows: String(statement).includes("drizzle.schema_capabilities")
        ? [{
            version: 1,
            contract_sha256: "7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d",
          }]
        : [
        baseRow,
        {
          ...baseRow,
          code: "dream-premium",
          display_name: "Dream Premium",
          entitlement_id: null,
          required_plan_code: "dream",
        },
          ],
    }));

    vi.setSystemTime(now);
    const response = await handleGatewayModels(
      new Request("https://gateway.example.test/v1/models"),
    );
    vi.useRealTimers();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: "dream-balanced",
        callable: true,
        availability: "included",
        required_plan_code: "free",
        claude_code_auto_compact_window: 262144,
        claude_code_max_context_tokens: 262144,
      }),
      expect.objectContaining({
        id: "dream-premium",
        callable: true,
        availability: "included",
        required_plan_code: "dream",
      }),
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /ciphertext|api_key|secret|upstream_model|provider_id|key_prefix/i,
    );
    expect(payload.data[0]).not.toHaveProperty("gateway_scopes");
    expect(payload.data[0].endpoint_availability.responses_image).toEqual({ generation: false, edit: false, configured: false, entitled: true, callable: false });
    expect(payload.default_model_alias).toBe("dream-balanced");
    const sql = mocks.query.mock.calls.find(([statement]) => String(statement).includes("FROM ai_models AS model"))![0] as string;
    expect(sql).toContain("FROM ai_models AS model");
    expect(sql).toContain("WHERE model.enabled = TRUE");
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("managed.provider_id = provider.id");
    expect(sql).toContain("managed.id = provider.managed_credential_id");
    expect(sql).not.toContain("ai_provider_managed_account_defaults");
  });

  it("projects allowance-only text callability without requiring a plan entitlement", async () => {
    mocks.query.mockImplementation(async (statement) => ({
      rows: String(statement).includes("drizzle.schema_capabilities")
        ? [{ version: 1, contract_sha256: "7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d" }]
        : [{ ...baseRow, entitlement_id: null, messages_entitled: false, chat_entitled: false }],
    }));
    vi.setSystemTime(now);
    try {
      const response = await handleGatewayModels(new Request("https://gateway.example.test/v1/models"));
      expect(response.status).toBe(200);
      const model = (await response.json()).data[0];
      expect(model.endpoint_availability.messages).toEqual({ callable: true, entitled: true });
      expect(model.endpoint_availability.chat).toEqual({ callable: true, entitled: true });
      expect(model.endpoint_availability.images.callable).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it.each([{ chat: false, image_generation: true }, { image_generation: true, image_edit: true }])("keeps Images-only form shape out of Messages and Chat: %j", async capabilities => {
    mocks.query.mockImplementation(async (statement) => ({
      rows: String(statement).includes("drizzle.schema_capabilities")
        ? [{ version: 1, contract_sha256: "7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d" }]
        : [{ ...baseRow, capabilities, image_input_token_reserve_per_image: 100,
          messages_entitled: false, chat_entitled: false, images_entitled: true,
          image_output_token_reserve_per_image: 100, image_pricing_ready: true, image_provider_ready: true }],
    }));
    vi.setSystemTime(now);
    try {
      const response = await handleGatewayModels(new Request("https://gateway.example.test/v1/models"));
      const payload = await response.json();
      const model = payload.data[0];
      expect(model.endpoint_availability.messages.callable).toBe(false);
      expect(model.endpoint_availability.chat.callable).toBe(false);
      expect(model.endpoint_availability.images.callable).toBe(true);
      expect(payload.default_model_alias).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    [{ subscription_id: null }, "subscription_inactive"],
    [{ provider_ready: false }, "maintenance"],
    [{ pricing_ready: false }, "maintenance"],
    [{ permission_enabled: false }, "permission_denied"],
    [{ allowance_id: null }, "subscription_inactive"],
    [{ remaining_tokens: "0" }, "allowance_exhausted"],
  ])("evaluates %j as %s", (patch, availability) => {
    expect(evaluateModelAvailability({ ...baseRow, ...patch }, now)).toEqual({
      callable: false,
      availability,
    });
  });

  it.each([
    { entitlement_id: null, required_plan_code: "dream" },
    { entitlement_id: null, required_plan_code: null },
  ])("keeps enabled models callable without a plan entitlement: %j", (patch) => {
    expect(evaluateModelAvailability({ ...baseRow, ...patch }, now)).toEqual({
      callable: true,
      availability: "included",
    });
  });
});
it('publishes distinct native capabilities only with exact contract, role permissions and explicit Responses provider',async()=>{
 const row={...baseRow,capabilities:{chat:true,tools:true,responses_image_generation:true,responses_image_edit:true,image_generation:false,image_edit:false},responses_image_provider_ready:true,image_input_token_reserve_per_image:100,image_output_token_reserve_per_image:100};
 mocks.authenticate.mockResolvedValue({platformUserId:'platform-user-1',tier:'member'});
 mocks.query.mockImplementation(async(statement,args)=>({rows:String(statement).includes('drizzle.schema_capabilities')
   ? args?.[0]==='dream.image-turn.v1'?[{version:1,contract_sha256:'2f7e1eedb84d974b6bf203611acaf22b00d1cb82e377276a73822e73253f96e2',can_use_schema:true,can_read:true,can_append:true,can_audit:true}]:[{version:1,contract_sha256:'7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d'}]
   :[row]}));
 vi.setSystemTime(now);
 const response=await handleGatewayModels(new Request('https://admin.example/v1/models'));
 vi.useRealTimers();
 expect(response.status).toBe(200);const payload=await response.json();
 expect(payload.data[0].endpoint_availability.responses_image).toEqual({generation:true,edit:true,configured:true,entitled:true,callable:true});
 expect(payload.data[0].endpoint_availability.images).toMatchObject({generation:false,edit:false,callable:false});
});
