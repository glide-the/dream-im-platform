import { expect, test, type Page } from "@playwright/test";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const superEmail = "super-admin@example.test";
const superPassword = "Test-super-admin-2026!";
const auditorEmail = "auditor@example.test";
const auditorPassword = "Test-auditor-pass-2026!";

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
  test.skip(!bootstrapToken, "Set ADMIN_BOOTSTRAP_E2E_TOKEN only for an owned isolated PostgreSQL lane");

  test("validates source data, control plane, RBAC, billing and both viewports", async ({ context, page, request, baseURL }, testInfo) => {
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

    const stories = await api.get(`${baseURL}/api/admin/story-stories?filter[title][contains]=真实源`);
    expect(stories.status()).toBe(200);
    await expect(stories.json()).resolves.toMatchObject({ data: [{ id: "story-e2e", title: "真实源剧本" }], meta: { total: 1 } });

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
    expect(duplicateCrosswalk.status()).toBe(409);

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
    const overlappingPricing = await api.post(`${baseURL}/api/admin/pricing-rules`, {
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
        effectiveFrom: new Date(Date.parse(pricingVersionStart) + 1_000).toISOString(),
        effectiveTo: null,
      },
    });
    expect(overlappingPricing.status()).toBe(409);

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
      data: { platformUserId: "user-e2e", name: "one-time-e2e", scopes: ["messages:create"], expiresAt: null },
    });
    expect(gatewayKey.status()).toBe(201);
    const gatewayKeyBody = await gatewayKey.json();
    expect(gatewayKeyBody.data.plaintextKey).toMatch(/^gw_/);
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
    const credit = await api.post(`${baseURL}/api/admin/platform-users/user-e2e/account/credit`, {
      headers,
      data: { amountMicrousd: 1000000, reason: "E2E controlled balance credit", idempotencyKey: creditIdempotencyKey },
    });
    expect(credit.status()).toBe(200);
    expect((await credit.json()).data.idempotent).toBe(false);
    const duplicateCredit = await api.post(`${baseURL}/api/admin/platform-users/user-e2e/account/credit`, {
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
    expect(reconciliation.status()).toBe(200);
    const reconciled = await api.get(`${baseURL}/api/admin/gateway-requests/request-settlement-failed-e2e`);
    await expect(reconciled.json()).resolves.toMatchObject({ data: { status: "settled", charged_microusd: "0" } });

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

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/models/providers");
    await expect(page.getByRole("heading", { name: "Provider", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增 Provider" }).click();
    const providerDialog = page.getByRole("dialog", { name: "新增 Provider" });
    await expect(providerDialog).toBeVisible();
    await expect(providerDialog.getByLabel("Provider Code")).toBeVisible();
    await expect(providerDialog.getByLabel("API Endpoint")).toBeVisible();
    await expect(providerDialog.getByLabel("API Key / Credential")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-provider-dialog-desktop-1440x1000.png"), fullPage: true });
    await providerDialog.getByRole("button", { name: "关闭" }).click();

    await page.goto("/admin/story/stories");
    await expect(page.getByRole("heading", { name: "剧本项目", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-story-desktop-1440x1000.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/models/providers");
    await page.getByRole("button", { name: "新增 Provider" }).click();
    const mobileProviderDialog = page.getByRole("dialog", { name: "新增 Provider" });
    await expect(mobileProviderDialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("admin-provider-dialog-mobile-390x844.png") });
    await mobileProviderDialog.getByRole("button", { name: "关闭" }).click();

    await context.clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel("管理员邮箱").fill(auditorEmail);
    await page.getByLabel("密码").fill(auditorPassword);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const forbidden = await context.request.patch(`${baseURL}/api/admin/story-stories/story-e2e`, { headers, data: { title: "Auditor must not write" } });
    expect(forbidden.status()).toBe(403);

    await page.goto("/admin");
    await page.getByRole("button", { name: "菜单" }).click();
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
