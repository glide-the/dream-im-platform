import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const superEmail = "super-admin@example.test";
const superPassword = "Test-super-admin-2026!";
const auditorEmail = "auditor@example.test";
const auditorPassword = "Test-auditor-pass-2026!";
let mockUpstream: Server | undefined;
let mockUpstreamUrl = "";
let mockValidationRequests: Array<{ authorization?: string; body: string }> = [];

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("server responded with a status of 401")) {
      diagnostics.push(`console: ${text}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (failedRequest) => {
    const reason = failedRequest.failure()?.errorText ?? "failed";
    if (reason !== "net::ERR_ABORTED") diagnostics.push(`${reason}: ${failedRequest.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

test.describe("Refine Admin with owned isolated PostgreSQL", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!bootstrapToken, "Set ADMIN_BOOTSTRAP_E2E_TOKEN only for an owned isolated PostgreSQL lane");

  test.beforeAll(async () => {
    mockValidationRequests = [];
    mockUpstream = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += String(chunk).slice(0, 8_192); });
      request.on("end", () => {
        mockValidationRequests.push({ authorization: request.headers.authorization, body });
        if (request.method === "GET" && request.url?.includes("/models")) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: [
            { id: "deepseek-v4-pro", owned_by: "deepseek" },
            { id: "discovery-new-model", owned_by: "deepseek", display_name: "Discovery New" },
          ] }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"id":"mock-response","content":[]}');
      });
    });
    await new Promise<void>((resolve, reject) => {
      mockUpstream!.once("error", reject);
      mockUpstream!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = mockUpstream.address() as AddressInfo;
    mockUpstreamUrl = `http://127.0.0.1:${address.port}`;
  });

  test.afterAll(async () => {
    if (!mockUpstream) return;
    await new Promise<void>((resolve, reject) => mockUpstream!.close((error) => error ? reject(error) : resolve()));
  });

  test("validates source data, control plane, RBAC, billing and both viewports", async ({ context, page, request, baseURL }, testInfo) => {
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    const diagnostics = collectDiagnostics(page);
    const origin = new URL(baseURL!).origin;

    expect((await request.get(`${baseURL}/api/admin/story-stories`)).status()).toBe(401);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "设置首位管理员" })).toBeVisible();
    await expect(page.getByLabel("管理员邮箱")).toHaveValue("");
    await expect(page.getByLabel("初始密码")).toHaveValue("");
    await page.getByLabel("显示名称").fill("E2E Super Admin");
    await page.getByLabel("管理员邮箱").fill(superEmail);
    await page.getByLabel("初始密码").fill(superPassword);
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();

    const api = context.request;
    const headers = { origin, "content-type": "application/json" };

    const sourceUsers = await api.get(`${baseURL}/api/admin/source-users`);
    expect(sourceUsers.status()).toBe(200);
    const sourceUsersBody = await sourceUsers.json();
    expect(sourceUsersBody.data[0]).toMatchObject({ id: "101", email: "creator@example.test" });
    expect(JSON.stringify(sourceUsersBody)).not.toContain("password_hash");

    const canonicalUsers = await api.get(`${baseURL}/api/admin/users?sort=updated_at&order=desc`);
    expect(canonicalUsers.status()).toBe(200);
    await expect(canonicalUsers.json()).resolves.toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id: "101", workspace_count: 1, story_count: 1 })]) });
    const platformUsers = await api.get(`${baseURL}/api/admin/platform-users?sort=email&order=asc`);
    expect(platformUsers.status()).toBe(200);
    const platformUsersBody = await platformUsers.json();
    expect(platformUsersBody.meta.total).toBe(2);
    expect(platformUsersBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ external_user_id: "101", email: "creator@example.test", billing_account_id: expect.any(String) }),
      expect.objectContaining({ external_user_id: "102", email: "other@example.test", billing_account_id: expect.any(String) }),
    ]));
    const creatorBillingUserId = String(platformUsersBody.data.find((user: { external_user_id: string }) => user.external_user_id === "101")?.id);
    expect(creatorBillingUserId).not.toBe("undefined");
    expect((await api.patch(`${baseURL}/api/admin/users/101`, { headers, data: { status: "disabled" } })).status()).toBe(405);

    const workspaceCreate = await api.post(`${baseURL}/api/admin/story-workspaces`, {
      headers,
      data: { ownerId: 101, name: "E2E 运营工作区", settings: { language: "zh-CN" } },
    });
    expect(workspaceCreate.status()).toBe(405);
    expect((await api.patch(`${baseURL}/api/admin/story-workspaces/workspace-e2e`, { headers, data: { settings: { language: "zh-CN", reviewed: true } } })).status()).toBe(200);

    const stories = await api.get(`${baseURL}/api/admin/story-stories?filter[title][contains]=真实源`);
    expect(stories.status()).toBe(200);
    await expect(stories.json()).resolves.toMatchObject({ data: [{ id: "story-e2e", title: "真实源剧本" }], meta: { total: 1 } });
    expect((await api.get(`${baseURL}/api/admin/stories?filter[workspace_id][eq]=workspace-e2e&sort=updated_at&order=desc`)).status()).toBe(200);

    const businessDashboard = await api.get(`${baseURL}/api/admin/dashboard`);
    expect(businessDashboard.status()).toBe(200);
    await expect(businessDashboard.json()).resolves.toMatchObject({ data: { sourceUsers: 2, storyStories: 2 } });
    expect((await api.get(`${baseURL}/api/admin/roles`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/permissions`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/storage-resources`)).status()).toBe(200);

    const invalidStoryPatch = await api.patch(`${baseURL}/api/admin/story-stories/story-e2e`, { headers, data: { unknownField: true } });
    expect(invalidStoryPatch.status()).toBe(400);
    const createStory = await api.post(`${baseURL}/api/admin/story-stories`, { headers, data: { title: "禁止创建" } });
    expect(createStory.status()).toBe(405);
    const crossWorkspaceScene = await api.patch(`${baseURL}/api/admin/story-scenes/scene-e2e`, { headers, data: { storyId: "story-other" } });
    expect(crossWorkspaceScene.status()).toBe(409);

    const updateStory = await api.patch(`${baseURL}/api/admin/story-stories/story-e2e`, { headers, data: { title: "真实源剧本（已核对）" } });
    expect(updateStory.status()).toBe(200);
    const confirmStory = await api.post(`${baseURL}/api/admin/story-stories/story-e2e/confirm`, { headers, data: {} });
    expect(confirmStory.status()).toBe(200);
    await expect(confirmStory.json()).resolves.toMatchObject({ data: { id: "story-e2e", status: "published", review_status: "confirmed" } });

    const duplicateCrosswalk = await api.post(`${baseURL}/api/admin/platform-users`, {
      headers,
      data: { source: "ink-dream", externalUserId: "101", email: "duplicate@example.test", displayName: "Duplicate", tier: "free", status: "active", metadata: {} },
    });
    expect(duplicateCrosswalk.status()).toBe(405);

    const provider = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: { code: "provider-secret-e2e", name: "Secret E2E", protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "fixture-provider-secret-never-log", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: { authMode: "x-api-key" } },
    });
    expect(provider.status()).toBe(201);
    const providerBody = await provider.json();
    expect(JSON.stringify(providerBody)).not.toContain("fixture-provider-secret-never-log");
    const providerDetail = await api.get(`${baseURL}/api/admin/providers/${providerBody.data.id}`);
    const providerDetailBody = await providerDetail.json();
    expect(providerDetailBody.data.credential_configured).toBe(true);
    expect(JSON.stringify(providerDetailBody)).not.toContain("api_key_ciphertext");

    const blockedProviderHost = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "blocked-provider-host-e2e",
        name: "Blocked Provider Host",
        protocol: "openai",
        baseUrl: "https://unlisted-provider.example.test/v1",
        apiKey: "fixture-blocked-provider-secret",
        status: "disabled",
        timeoutMs: 5000,
        maxRetries: 0,
        config: { authMode: "bearer", modelCatalogMode: "auto" },
      },
    });
    expect(blockedProviderHost.status()).toBe(409);
    await expect(blockedProviderHost.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_HOST_NOT_ALLOWED",
        message: expect.stringContaining("AI_PROVIDER_HOST_ALLOWLIST"),
        details: {
          hostname: "unlisted-provider.example.test",
          configuration: "AI_PROVIDER_HOST_ALLOWLIST",
          restartRequired: true,
        },
      },
    });

    const validationProvider = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: { code: "mock-validation-e2e", name: "Mock Validation", protocol: "anthropic", baseUrl: mockUpstreamUrl, apiKey: "fixture-model-validation-secret", status: "active", timeoutMs: 5000, maxRetries: 0, config: { authMode: "bearer" } },
    });
    expect(validationProvider.status()).toBe(201);
    const validationProviderBody = await validationProvider.json();
    const validationModel = await api.post(`${baseURL}/api/admin/models`, {
      headers,
      data: { providerId: validationProviderBody.data.id, code: "mock-validation-model", upstreamModel: "deepseek-v4-pro", displayName: "Mock Validation Model", contextWindow: 128000, maxOutputTokens: 8192, capabilities: { chat: true }, enabled: true },
    });
    expect(validationModel.status()).toBe(201);
    const validationModelBody = await validationModel.json();
    const validation = await api.post(`${baseURL}/api/admin/models/${validationModelBody.data.id}/validate`, { headers });
    expect(validation.status()).toBe(200);
    await expect(validation.json()).resolves.toMatchObject({ data: { status: "operational", usable: true, httpStatus: 200 } });
    expect(mockValidationRequests).toHaveLength(1);
    expect(mockValidationRequests[0].authorization).toBe("Bearer fixture-model-validation-secret");
    expect(JSON.parse(mockValidationRequests[0].body)).toMatchObject({ model: "deepseek-v4-pro", max_tokens: 1, stream: false });

    const discovery = await api.post(
      `${baseURL}/api/admin/providers/${validationProviderBody.data.id}/discover`,
      { headers },
    );
    expect(discovery.status()).toBe(200);
    const discoveryBody = await discovery.json();
    expect(JSON.stringify(discoveryBody)).not.toContain("fixture-model-validation-secret");
    expect(discoveryBody.data.diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deepseek-v4-pro", state: "existing" }),
      expect.objectContaining({ id: "discovery-new-model", state: "new" }),
    ]));

    const manualProvider = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "manual-catalog-e2e",
        name: "Manual Catalog E2E",
        protocol: "openai",
        baseUrl: mockUpstreamUrl,
        apiKey: "fixture-manual-provider-secret",
        status: "disabled",
        timeoutMs: 5000,
        maxRetries: 0,
        config: {
          authMode: "bearer",
          modelCatalogMode: "manual",
          manualModel: "hy3-preview",
          outputTokenParam: "max_tokens",
        },
      },
    });
    expect(manualProvider.status()).toBe(201);
    const manualProviderBody = await manualProvider.json();
    expect(JSON.stringify(manualProviderBody)).not.toContain("fixture-manual-provider-secret");
    expect(manualProviderBody.data.config).toMatchObject({
      modelCatalogMode: "manual",
      manualModel: "hy3-preview",
    });
    const requestsBeforeDisabledDiscovery = mockValidationRequests.length;
    const disabledDiscovery = await api.post(
      `${baseURL}/api/admin/providers/${manualProviderBody.data.id}/discover`,
      { headers },
    );
    expect(disabledDiscovery.status()).toBe(409);
    await expect(disabledDiscovery.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MODEL_DISCOVERY_DISABLED" },
    });
    expect(mockValidationRequests).toHaveLength(requestsBeforeDisabledDiscovery);

    const pricingVersionStart = new Date(Date.now() + 60_000).toISOString();
    const pricingVersion = await api.post(`${baseURL}/api/admin/pricing-rules`, {
      headers,
      data: {
        modelId: "model-e2e",
        userTier: "free",
        inputPriceMicrousdPerMillion: 3500000,
        outputPriceMicrousdPerMillion: 16000000,
        cacheReadPriceMicrousdPerMillion: 350000,
        cacheWritePriceMicrousdPerMillion: 4000000,
        markupBps: 0,
        discountBps: 0,
        status: "active",
        effectiveFrom: pricingVersionStart,
        effectiveTo: null,
        replacesPricingRuleId: "pricing-e2e",
      },
    });
    expect(pricingVersion.status()).toBe(201);
    const pricingVersionBody = await pricingVersion.json();
    expect(pricingVersionBody.data).toMatchObject({
      model_id: "model-e2e",
      replaced_pricing_rule_id: "pricing-e2e",
    });
    const mutateHistoricalPrice = await api.patch(`${baseURL}/api/admin/pricing-rules/pricing-e2e`, {
      headers,
      data: { inputPriceMicrousdPerMillion: 1 },
    });
    expect(mutateHistoricalPrice.status()).toBe(400);
    const automaticPricingVersionStart = new Date(Date.parse(pricingVersionStart) + 1_000).toISOString();
    const automaticPricingVersion = await api.post(`${baseURL}/api/admin/pricing-rules`, {
      headers,
      data: {
        modelId: "model-e2e",
        userTier: "free",
        inputPriceMicrousdPerMillion: 1,
        outputPriceMicrousdPerMillion: 1,
        cacheReadPriceMicrousdPerMillion: 0,
        cacheWritePriceMicrousdPerMillion: 0,
        markupBps: 0,
        discountBps: 0,
        status: "active",
        effectiveFrom: automaticPricingVersionStart,
        effectiveTo: null,
      },
    });
    expect(automaticPricingVersion.status()).toBe(201);
    await expect(automaticPricingVersion.json()).resolves.toMatchObject({
      data: {
        model_id: "model-e2e",
        replaced_pricing_rule_id: pricingVersionBody.data.id,
      },
    });
    const truePricingConflict = await api.post(`${baseURL}/api/admin/pricing-rules`, {
      headers,
      data: {
        modelId: "model-e2e",
        userTier: "free",
        inputPriceMicrousdPerMillion: 2,
        outputPriceMicrousdPerMillion: 2,
        cacheReadPriceMicrousdPerMillion: 0,
        cacheWritePriceMicrousdPerMillion: 0,
        markupBps: 0,
        discountBps: 0,
        status: "active",
        effectiveFrom: new Date(Date.parse(pricingVersionStart) + 500).toISOString(),
        effectiveTo: null,
      },
    });
    expect(truePricingConflict.status()).toBe(409);
    await expect(truePricingConflict.json()).resolves.toMatchObject({
      error: { code: "PRICING_REPLACEMENT_TIME_INVALID" },
    });

    const pricingSyncSnapshotId = "pricing-sync-real-e2e";
    const pricingSyncClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await pricingSyncClient.connect();
    try {
      await pricingSyncClient.query(
        `INSERT INTO ai_pricing_sync_snapshots (
           id, provider_id, catalog_ref, catalog_version, catalog_hash,
           matches, created_by, expires_at
         ) VALUES ($1, $2, 'https://models.dev/api.json', 'fixture-catalog-v1',
                   'fixture-catalog-hash', $3::jsonb, 'e2e', now() + interval '10 minutes')`,
        [pricingSyncSnapshotId, validationProviderBody.data.id, JSON.stringify([{
          localModelId: validationModelBody.data.id,
          localModelCode: "mock-validation-model",
          upstreamModel: "deepseek-v4-pro",
          providerCode: "mock-validation-e2e",
          match: "exact",
          key: "deepseek/deepseek-v4-pro",
          providerId: "deepseek",
          providerName: "DeepSeek",
          modelId: "deepseek-v4-pro",
          normalizedId: "deepseek-v4-pro",
          modelName: "DeepSeek V4 Pro",
          releaseDate: "2026-08-01",
          inputMicrousd: "300000",
          outputMicrousd: "1200000",
          cacheReadMicrousd: "60000",
          cacheWriteMicrousd: "375000",
        }])],
      );
      await pricingSyncClient.query(
        `INSERT INTO ai_pricing_sync_snapshots (
           id, provider_id, catalog_ref, catalog_version, catalog_hash,
           matches, created_by, expires_at
         ) VALUES ('pricing_sync_ui_e2e', 'provider-e2e',
                   'https://models.dev/api.json', 'fixture-ui-v1',
                   'fixture-ui-hash', $1::jsonb, 'e2e', now() + interval '10 minutes')`,
        [JSON.stringify([{
          localModelId: "model-e2e",
          localModelCode: "model-e2e",
          upstreamModel: "model-e2e-upstream",
          providerCode: "provider-e2e",
          match: "exact",
          key: "anthropic/claude-e2e",
          providerId: "anthropic",
          providerName: "Anthropic",
          modelId: "claude-e2e",
          normalizedId: "claude-e2e",
          modelName: "Claude E2E",
          releaseDate: "2026-08-01",
          inputMicrousd: "3000000",
          outputMicrousd: "15000000",
          cacheReadMicrousd: "300000",
          cacheWriteMicrousd: "3750000",
        }])],
      );
    } finally {
      await pricingSyncClient.end();
    }
    const applyPricingSync = await api.post(
      `${baseURL}/api/admin/pricing-sync/${pricingSyncSnapshotId}/apply`,
      {
        headers,
        data: {
          modelIds: [validationModelBody.data.id],
          effectiveFrom: new Date(Date.now() + 180_000).toISOString(),
        },
      },
    );
    expect(applyPricingSync.status()).toBe(200);
    await expect(applyPricingSync.json()).resolves.toMatchObject({ data: { selectedCount: 1 } });
    const syncedPricing = await api.get(`${baseURL}/api/admin/pricing-rules?filter[model_id][eq]=${encodeURIComponent(validationModelBody.data.id)}`);
    expect(syncedPricing.status()).toBe(200);
    await expect(syncedPricing.json()).resolves.toMatchObject({ data: [expect.objectContaining({ source: "models.dev", source_version: "fixture-catalog-v1" })] });

    const secretSetting = await api.post(`${baseURL}/api/admin/system-settings`, {
      headers,
      data: { category: "e2e", key: "masked-secret", value: { token: "never-return-me" }, description: "E2E secret", isSecret: true, status: "active" },
    });
    expect(secretSetting.status()).toBe(201);
    const secretSettingBody = await secretSetting.json();
    expect(secretSettingBody).toMatchObject({ data: { value: { masked: true } } });
    const updateSecretMetadata = await api.patch(`${baseURL}/api/admin/system-settings/${secretSettingBody.data.id}`, {
      headers,
      data: { value: { masked: true }, description: "E2E secret metadata updated" },
    });
    expect(updateSecretMetadata.status()).toBe(200);
    expect(await updateSecretMetadata.json()).toMatchObject({ data: { value: { masked: true }, description: "E2E secret metadata updated" } });
    expect((await api.delete(`${baseURL}/api/admin/system-settings/${secretSettingBody.data.id}`, { headers })).status()).toBe(405);

    const gatewayKey = await api.post(`${baseURL}/api/admin/gateway-api-keys`, {
      headers,
      data: { subjectMode: "fixed_user", platformUserId: creatorBillingUserId, name: "one-time-e2e", scopes: ["messages:create"], expiresAt: null },
    });
    expect(gatewayKey.status()).toBe(201);
    const gatewayKeyBody = await gatewayKey.json();
    expect(gatewayKeyBody.data.plaintextKey).toMatch(/^gw_/);
    expect(gatewayKeyBody.data.gatewayBaseUrl).toBe(origin);
    const keyDetail = await api.get(`${baseURL}/api/admin/gateway-api-keys/${gatewayKeyBody.data.id}`);
    expect(JSON.stringify(await keyDetail.json())).not.toContain(gatewayKeyBody.data.plaintextKey);
    const missingAliasThroughProxy = await api.post(`${baseURL}/v1/messages`, {
      headers: { "content-type": "application/json", "x-api-key": gatewayKeyBody.data.plaintextKey },
      data: { model: "missing-external-alias", max_tokens: 16, messages: [{ role: "user", content: "contract only" }] },
    });
    expect(missingAliasThroughProxy.status()).toBe(404);
    expect((await missingAliasThroughProxy.json()).error.code).toBe("MODEL_NOT_AVAILABLE");
    const wrongScopeModelList = await api.get(`${baseURL}/v1/models`, {
      headers: { authorization: `Bearer ${gatewayKeyBody.data.plaintextKey}` },
    });
    expect(wrongScopeModelList.status()).toBe(403);
    expect((await api.delete(`${baseURL}/api/admin/gateway-api-keys/${gatewayKeyBody.data.id}`, { headers })).status()).toBe(200);
    await expect((await api.get(`${baseURL}/api/admin/gateway-api-keys/${gatewayKeyBody.data.id}`)).json()).resolves.toMatchObject({ data: { status: "revoked" } });
    expect((await api.get(`${baseURL}/v1/models`, { headers: { authorization: `Bearer ${gatewayKeyBody.data.plaintextKey}` } })).status()).toBe(401);

    const creditIdempotencyKey = "credit-e2e-idempotency";
    const credit = await api.post(`${baseURL}/api/admin/platform-users/${encodeURIComponent(creatorBillingUserId)}/account/credit`, {
      headers,
      data: { amountMicrousd: 1000000, reason: "E2E controlled balance credit", idempotencyKey: creditIdempotencyKey },
    });
    expect(credit.status()).toBe(200);
    expect((await credit.json()).data.idempotent).toBe(false);
    const duplicateCredit = await api.post(`${baseURL}/api/admin/platform-users/${encodeURIComponent(creatorBillingUserId)}/account/credit`, {
      headers,
      data: { amountMicrousd: 1000000, reason: "E2E controlled balance credit", idempotencyKey: creditIdempotencyKey },
    });
    expect(duplicateCredit.status()).toBe(200);
    expect((await duplicateCredit.json()).data.idempotent).toBe(true);

    const permissionUpdate = await api.patch(`${baseURL}/api/admin/user-model-permissions/model-permission-e2e`, {
      headers,
      data: { enabled: false, requestsPerMinute: 10 },
    });
    expect(permissionUpdate.status()).toBe(200);
    expect((await permissionUpdate.json()).data.enabled).toBe(false);
    expect((await api.delete(`${baseURL}/api/admin/user-model-permissions/model-permission-e2e`, { headers })).status()).toBe(200);

    expect((await api.get(`${baseURL}/api/admin/models`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/pricing-rules`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/billing-accounts`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/ledger`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/gateway-rate-limits`)).status()).toBe(200);
    const usageDashboard = await api.get(`${baseURL}/api/admin/usage-dashboard`);
    expect(usageDashboard.status()).toBe(200);
    expect(Number((await usageDashboard.json()).data.summary.requests)).toBeGreaterThanOrEqual(1);
    expect((await api.get(`${baseURL}/api/storage`)).status()).toBe(200);

    const reconciliation = await api.post(`${baseURL}/api/admin/gateway-requests/request-settlement-failed-e2e/reconcile`, {
      headers,
      data: { mode: "release_unbilled", confirmation: "RELEASE_UNBILLED", reason: "E2E evidence confirms no provider usage", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(reconciliation.status()).toBe(404);
    const recordedFailure = await api.get(`${baseURL}/api/admin/gateway-requests/request-settlement-failed-e2e`);
    await expect(recordedFailure.json()).resolves.toMatchObject({
      data: {
        status: "settlement_failed",
        outcome: "failed",
        error_code: "UPSTREAM_STREAM_INTERRUPTED",
        reserved_microusd: "1000000",
      },
    });

    const currentAdmins = await api.get(`${baseURL}/api/admin/admin-users?filter[email][eq]=${encodeURIComponent(superEmail)}`);
    expect(currentAdmins.status()).toBe(200);
    const currentAdminsBody = await currentAdmins.json();
    expect(currentAdminsBody.data).toHaveLength(1);
    const removeLastSuperAdmin = await api.patch(`${baseURL}/api/admin/admin-users/${currentAdminsBody.data[0].id}`, {
      headers,
      data: { roleCodes: ["auditor"] },
    });
    expect(removeLastSuperAdmin.status()).toBe(409);

    const auditor = await api.post(`${baseURL}/api/admin/admin-users`, {
      headers,
      data: { email: auditorEmail, displayName: "E2E Auditor", password: auditorPassword, roleCodes: ["auditor"] },
    });
    expect(auditor.status()).toBe(201);

    const isolatedPool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const isolatedClient = await isolatedPool.connect();
    try {
      await isolatedClient.query("BEGIN");
      await isolatedClient.query("SET LOCAL session_replication_role = replica");
      await isolatedClient.query(
        `INSERT INTO users (id, email, password_hash, display_name, role)
         VALUES (103, 'no-billing-identity@example.test', 'fixture-password-hash-not-a-credential', '未绑定创作者', 'user')`,
      );
      await isolatedClient.query(
        `INSERT INTO story_workspace_workspaces (id, name, owner_id, settings)
         VALUES ('workspace-no-billing-e2e', 'E2E 无计费映射空间', 103, '{"language":"zh-CN"}'::jsonb)`,
      );
      await isolatedClient.query(
        `INSERT INTO story_workspace_stories (
           id, identifier, title, description, author_id, workspace_id,
           character_count, scene_count, agent_generated
         ) VALUES (
           'story-no-billing-e2e', 'story-no-billing-e2e',
           '无计费映射仍可见剧本', '只用于隔离 PostgreSQL 可见性验收',
           103, 'workspace-no-billing-e2e', 0, 0, 0
         )`,
      );
      await isolatedClient.query("COMMIT");
    } catch (error) {
      await isolatedClient.query("ROLLBACK");
      throw error;
    } finally {
      isolatedClient.release();
      await isolatedPool.end();
    }

    const workspaceVisibility = await api.get(
      `${baseURL}/api/admin/story-workspaces?sort=updated_at&order=desc`,
    );
    expect(workspaceVisibility.status()).toBe(200);
    const workspaceVisibilityBody = await workspaceVisibility.json();
    expect(workspaceVisibilityBody.meta.total).toBe(3);
    expect(workspaceVisibilityBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "workspace-no-billing-e2e",
        owner_id: "103",
        billing_identity_bound: false,
        relation_health: "healthy",
      }),
    ]));
    const storyVisibility = await api.get(
      `${baseURL}/api/admin/story-stories?sort=updated_at&order=desc`,
    );
    expect(storyVisibility.status()).toBe(200);
    const storyVisibilityBody = await storyVisibility.json();
    expect(storyVisibilityBody.meta.total).toBe(3);
    expect(storyVisibilityBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "story-no-billing-e2e",
        author_id: "103",
        billing_identity_bound: false,
        relation_health: "healthy",
      }),
    ]));
    expect(storyVisibilityBody.data.every((story: Record<string, unknown>) => !("content" in story))).toBe(true);
    const countPool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const databaseCounts = await countPool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM story_workspace_workspaces) AS workspaces,
         (SELECT COUNT(*)::int FROM story_workspace_stories) AS stories`,
    );
    await countPool.end();
    expect(databaseCounts.rows[0]).toMatchObject({ workspaces: 3, stories: 3 });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/models/providers");
    await expect(page.getByRole("heading", { name: "Provider", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "添加 Provider" }).click();
    await expect(page).toHaveURL(/\/admin\/models\/providers\/new$/);
    await expect(page.getByRole("heading", { name: "添加 Provider", exact: true })).toBeVisible();
    await expect(page.getByLabel("Provider Code")).toBeVisible();
    await expect(page.getByLabel("API Endpoint")).toBeVisible();
    await expect(page.getByLabel("API Key / Credential")).toBeVisible();
    await page.getByRole("button", { name: "DeepSeek Anthropic" }).click();
    await expect(page.getByLabel("API Endpoint")).toHaveValue("https://api.deepseek.com/anthropic");
    await expect(page.getByLabel("Provider Code")).toHaveValue("deepseek-anthropic");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-provider-page-desktop-1440x1000.png"), fullPage: true });
    await page.getByRole("button", { name: "自定义兼容端点" }).click();
    await page.getByLabel("Provider Code").fill("manual-ui-e2e");
    await page.getByLabel("显示名称").fill("Manual UI E2E");
    await page.getByLabel("API Endpoint").fill(mockUpstreamUrl);
    await page.getByLabel("API Key / Credential").fill("fixture-manual-ui-secret");
    await page.getByLabel("模型目录模式").selectOption("manual");
    await page.getByLabel("手工上游型号").fill("hy3-preview");
    const requestsBeforeManualUi = mockValidationRequests.length;
    await page.getByRole("button", { name: "添加 Provider", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/models\/models\/new\?providerId=.*upstreamModel=hy3-preview/);
    await expect(page.getByLabel("上游型号（Model Dropdown）")).toHaveValue("hy3-preview");
    await expect(page.getByLabel("模型别名 Code")).toHaveValue("hy3-preview");
    await expect(page.getByLabel("显示名称")).toHaveValue("hy3-preview");
    expect(mockValidationRequests).toHaveLength(requestsBeforeManualUi);

    await page.goto("/admin/models/models/new");
    await expect(page.getByRole("heading", { name: "添加模型", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^Provider \*/ })).toBeVisible();
    await expect(page.getByLabel("上游型号（Model Dropdown）")).toHaveValue("deepseek-v4-pro");
    await expect(page.getByRole("checkbox", { name: "对话", exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-model-page-desktop-1440x1000.png"), fullPage: true });

    await page.goto(`/admin/models/providers/${encodeURIComponent(validationProviderBody.data.id)}/discover/${encodeURIComponent(discoveryBody.data.id)}`);
    await expect(page.getByRole("heading", { name: "模型目录差异确认" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "discovery-new-model", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /应用 1 个模型/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-provider-discovery-desktop-1440x1000.png"), fullPage: true });
    const applyDiscovery = await api.post(
      `${baseURL}/api/admin/providers/${validationProviderBody.data.id}/apply-discovery`,
      { headers, data: { snapshotId: discoveryBody.data.id, modelIds: ["deepseek-v4-pro", "discovery-new-model"] } },
    );
    expect(applyDiscovery.status()).toBe(200);
    await expect(applyDiscovery.json()).resolves.toMatchObject({ data: { selectedCount: 2 } });

    await page.goto(`/admin/models/models?provider_id=${encodeURIComponent(validationProviderBody.data.id)}`);
    const validationCard = page.locator("article").filter({ hasText: "Mock Validation Model" });
    await expect(validationCard).toBeVisible();
    await validationCard.getByRole("button", { name: "验证配置" }).click();
    await expect(validationCard.getByText(/凭据与上游模型验证通过/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("admin-model-validation-desktop-1440x1000.png"), fullPage: true });

    await page.goto(`/admin/billing/usage?providerId=${encodeURIComponent(validationProviderBody.data.id)}`);
    await expect(page.getByRole("combobox", { name: "Provider" })).toHaveValue(validationProviderBody.data.id);

    await page.goto(`/admin/models/providers/${encodeURIComponent(validationProviderBody.data.id)}/edit`);
    await page.getByLabel("运行状态").selectOption("disabled");
    await page.getByRole("button", { name: "保存 Provider" }).click();
    await expect(page.getByRole("heading", { name: "确认停用 Provider" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("admin-provider-disable-confirm-desktop-1440x1000.png"), fullPage: true });
    await page.getByRole("button", { name: "取消", exact: true }).last().click();

    await page.goto("/admin/models/pricing/new?modelId=model-e2e");
    await expect(page.getByRole("heading", { name: "创建价格版本", exact: true })).toBeVisible();
    await expect(page.getByLabel("Input（USD / 1M tokens）")).toBeVisible();
    await expect(page.getByLabel("Output（USD / 1M tokens）")).toBeVisible();
    await expect(page.getByLabel("Markup（%）")).toBeVisible();
    await expect(page.getByText("0 bps", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("生效时间")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-pricing-page-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/models/pricing");
    await expect(
      page.locator("tbody tr").filter({ hasText: "model-e2e" }).filter({ hasText: "free · manual" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "model-e2e" }).filter({ hasText: "default · models.dev" }),
    ).toHaveCount(0);
    await page.goto("/admin/models/pricing/sync/pricing_sync_ui_e2e");
    await expect(page.getByRole("heading", { name: "价格目录差异确认" })).toBeVisible();
    await expect(page.getByText("model-e2e", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-pricing-sync-desktop-1440x1000.png"), fullPage: true });
    await page.getByRole("button", { name: /应用 1 个价格版本/ }).click();
    await expect(page).toHaveURL(/\/admin\/models\/pricing\?synced=/);
    await expect(
      page.locator("tbody tr").filter({ hasText: "model-e2e" }).filter({ hasText: "default · models.dev" }),
    ).toBeVisible();

    const storyListRequests: string[] = [];
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname.includes("/api/admin/story")) storyListRequests.push(url.pathname);
    });
    await page.goto("/admin/story/stories");
    await expect(page.getByRole("heading", { name: "剧本", exact: true }).first()).toBeVisible();
    await expect(page.getByText("无计费映射仍可见剧本", { exact: true })).toBeVisible();
    await expect(page.getByText("未绑定计费身份", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("3 条记录", { exact: true })).toBeVisible();
    expect(storyListRequests).toContain("/api/admin/story-stories");
    expect(storyListRequests).not.toContain("/api/admin/stories");

    await page.getByLabel("剧本标题").fill("不存在的剧本标题");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page).toHaveURL(/title=/);
    await expect(page.locator('[data-state="filter-empty"]')).toBeVisible();
    await expect(page.getByText("没有匹配当前筛选的记录", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).first().click();
    await expect(page).not.toHaveURL(/title=/);
    await page.reload();
    await expect(page.getByText("无计费映射仍可见剧本", { exact: true })).toBeVisible();

    await page.route("**/api/admin/story-stories?**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "STORY_SOURCE_UNAVAILABLE",
            message: "The Story PostgreSQL source is unavailable",
            requestId: "story-source-e2e",
          },
        }),
      });
    });
    await page.reload();
    await expect(page.locator('[data-state="error-503"]')).toBeVisible();
    await expect(page.getByText("PostgreSQL 数据源不可用", { exact: true })).toBeVisible();
    await expect(page.locator('[data-state="system-empty"]')).toHaveCount(0);
    await expect(page.locator('[data-state="filter-empty"]')).toHaveCount(0);
    await page.unroute("**/api/admin/story-stories?**");
    await page.route("**/api/admin/story-stories?**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "STORY_SOURCE_ERROR",
            message: "The Story service failed",
            requestId: "story-source-500-e2e",
          },
        }),
      });
    });
    await page.reload();
    await expect(page.locator('[data-state="error-500"]')).toBeVisible();
    await expect(page.getByText("Story 服务发生异常", { exact: true })).toBeVisible();
    await expect(page.locator('[data-state="system-empty"]')).toHaveCount(0);
    await page.unroute("**/api/admin/story-stories?**");
    await page.reload();
    await expect(page.getByText("无计费映射仍可见剧本", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-story-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/resources/users");
    await expect(page.getByRole("heading", { name: "平台用户", exact: true }).first()).toBeVisible();
    const unboundUserRow = page.locator("tbody tr").filter({ hasText: "no-billing-identity@example.test" });
    await expect(unboundUserRow).toBeVisible();
    await unboundUserRow.getByRole("link", { name: "1", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/story\/workspaces\?owner_id=103/);
    await expect(page.getByText("E2E 无计费映射空间", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(page).not.toHaveURL(/owner_id=/);
    await page.goto("/admin/resources/users");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-users-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/story/workspaces");
    await expect(page.getByRole("heading", { name: "工作区", exact: true }).first()).toBeVisible();
    await expect(page.getByText("E2E 无计费映射空间", { exact: true })).toBeVisible();
    const unboundWorkspaceRow = page.locator("tbody tr").filter({ hasText: "E2E 无计费映射空间" });
    await expect(unboundWorkspaceRow.getByText("未绑定计费身份", { exact: true })).toBeVisible();
    await unboundWorkspaceRow.getByRole("link", { name: "1", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/story\/stories\?workspace_id=workspace-no-billing-e2e/);
    await expect(page.getByText("无计费映射仍可见剧本", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.goto("/admin/story/workspaces");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-workspaces-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/resources/storage");
    await expect(page.getByRole("heading", { name: "文件存储", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "文件列表", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-storage-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/gateway/keys");
    await expect(page.getByRole("heading", { name: "Gateway Key", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "异常结算" })).toHaveCount(0);
    await page.getByRole("button", { name: "发放 Gateway Key" }).click();
    await page.getByRole("combobox", { name: "平台用户 *" }).selectOption(creatorBillingUserId);
    await page.getByLabel("Key 名称 *").fill("gateway-ui-e2e");
    await page.getByRole("button", { name: "创建并显示接入配置" }).click();
    await expect(page.getByRole("heading", { name: "Gateway Key 接入配置" })).toBeVisible();
    await expect(page.getByLabel("网关根地址")).toHaveText(origin);
    await expect(page.getByLabel("Anthropic Messages 入口")).toHaveText(`${origin}/v1/messages`);
    await expect(page.getByLabel("ANTHROPIC_BASE_URL 配置值")).toHaveText(origin);
    const oneTimeGatewayToken = await page.getByLabel("ANTHROPIC_AUTH_TOKEN 配置值").textContent();
    expect(oneTimeGatewayToken).toMatch(/^gw_/);
    await expect(page.getByLabel("Anthropic 完整环境配置")).toContainText(`ANTHROPIC_BASE_URL=${origin}`);
    await expect(page.getByLabel("Anthropic 完整环境配置")).toContainText(`ANTHROPIC_AUTH_TOKEN=${oneTimeGatewayToken}`);
    await expect(page.getByRole("button", { name: "复制地址" })).toBeVisible();
    await expect(page.getByRole("button", { name: "复制 Token" })).toBeVisible();
    await expect(page.getByRole("button", { name: "复制完整配置" })).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.getByRole("heading", { name: "Gateway Key 接入配置" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(oneTimeGatewayToken!);
    await expect(page.locator("tbody tr").filter({ hasText: "gateway-ui-e2e" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-gateway-keys-desktop-1440x1000.png"), fullPage: true });

    expect((await api.get(`${baseURL}/admin/gateway/reconciliation`)).status()).toBe(404);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/story/stories");
    await expect(page.getByRole("heading", { name: "剧本", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-story-mobile-390x844.png") });

    await page.goto("/admin/story/workspaces");
    await expect(page.getByRole("heading", { name: "工作区", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-workspaces-mobile-390x844.png") });

    await page.goto("/admin/models/providers");
    await page.getByRole("link", { name: "添加 Provider" }).click();
    await expect(page.getByRole("heading", { name: "添加 Provider", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-provider-page-mobile-390x844.png") });
    await page.getByRole("button", { name: "返回列表" }).click();

    await page.goto("/admin/models/models/new");
    await expect(page.getByRole("heading", { name: "添加模型", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^Provider \*/ })).toContainText("E2E Provider");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-model-page-mobile-390x844.png") });

    await page.goto("/admin/models/pricing/new?modelId=model-e2e");
    await expect(page.getByRole("heading", { name: "创建价格版本", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^模型 \*/ })).toHaveValue("model-e2e");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-pricing-page-mobile-390x844.png") });

    await page.goto("/admin/models/pricing/sync/pricing_sync_ui_e2e");
    await expect(page.getByRole("heading", { name: "价格目录差异确认" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-pricing-sync-mobile-390x844.png") });

    await page.goto(`/admin/billing/usage?modelId=${encodeURIComponent(validationModelBody.data.id)}`);
    await expect(page.getByRole("combobox", { name: "模型" })).toHaveValue(validationModelBody.data.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-usage-mobile-390x844.png") });

    await page.goto("/admin/gateway/keys");
    await expect(page.getByRole("heading", { name: "Gateway Key", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-gateway-keys-mobile-390x844.png") });

    await context.clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel("管理员邮箱").fill(auditorEmail);
    await page.getByLabel("密码").fill(auditorPassword);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const forbidden = await context.request.patch(`${baseURL}/api/admin/story-stories/story-e2e`, { headers, data: { title: "Auditor must not write" } });
    expect(forbidden.status()).toBe(403);
    const forbiddenStorageDelete = await context.request.delete(`${baseURL}/api/admin/storage-resources/ZG9jcy9hLnBkZg`, { headers, data: { confirmKey: "docs/a.pdf" } });
    expect(forbiddenStorageDelete.status()).toBe(403);
    const forbiddenProviderProbe = await context.request.post(
      `${baseURL}/api/admin/providers/${providerBody.data.id}/reachability`,
      { headers },
    );
    expect(forbiddenProviderProbe.status()).toBe(403);
    const forbiddenModelValidation = await context.request.post(
      `${baseURL}/api/admin/models/${validationModelBody.data.id}/validate`,
      { headers },
    );
    expect(forbiddenModelValidation.status()).toBe(403);

    await page.goto("/admin");
    const mobileMenuButton = page.getByRole("button", { name: "菜单" });
    await mobileMenuButton.focus();
    await mobileMenuButton.press("Enter");
    await expect(page.getByRole("dialog", { name: "管理后台导航" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-mobile-menu-390x844.png") });

    expect((await request.get(`${baseURL}/customers`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/todos`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/api/customers`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/api/claude-agent`)).status()).toBe(404);

    const secondBootstrap = await request.post(`${baseURL}/api/admin/auth/bootstrap`, {
      headers: { origin, "x-admin-bootstrap-token": bootstrapToken! },
      data: { email: "second@example.test", displayName: "Second Admin", password: "Test-second-admin-2026!" },
    });
    expect(secondBootstrap.status()).toBe(409);
    expect(diagnostics).toEqual([]);
  });
});
