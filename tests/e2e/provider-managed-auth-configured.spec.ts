// [Input] Runner-owned Admin/Gateway, official-host Copilot fake, and a named disposable PostgreSQL.
// [Output] Post-connect catalog failure/retry/advisory-lock reuse/review plus independent Provider accounts, exact routing, ownership recovery, and secret-safe evidence.
// [Pos] Provider-single-account managed-auth E2E success lane; all transitions use public production routes.
// [Sync] 2026-09-04: prove automatic account catalog snapshots and concurrent retries stay separate from credential success, Model enablement, and Pricing.

import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const configuredProduct = process.env.INK_MANAGED_AUTH_CONFIGURED_E2E;

const FORBIDDEN_SECRET_KEYS = [
  "device_code",
  "deviceCode",
  "sourceAccessToken",
  "sourceRefreshToken",
  "copilotAccessToken",
  "access_token",
  "refresh_token",
  "bundle_ciphertext",
  "bundleCiphertext",
  "client_secret",
  "clientSecret",
];

type ManagedAccount = {
  accountId: string;
  status: "connected" | "reauth_required" | "disconnected";
  authEpoch: number;
  revision: number;
  accountLabel: string | null;
  usable: boolean;
};

type ManagedStatus = {
  provider: {
    id: string;
    status: "active" | "disabled";
    activeCredentialKind: "managed_oauth" | "none";
    authEpoch: number;
  };
  readiness: {
    authorizationReady: boolean;
    credentialConnected: boolean;
    effective: boolean;
  };
  accounts: ManagedAccount[];
  defaultAccount: { accountId: string; revision: number } | null;
  binding: {
    mode: "pinned";
    accountId: string | null;
    providerAuthEpoch: number;
  };
  resolvedAccount: ManagedAccount | null;
  attempt: null | {
    id: string;
    status: string;
    revision: number;
    failureCode?: string | null;
  };
};

type CatalogSyncResult =
  | {
      status: "succeeded";
      snapshotId: string;
      discoveredCount: number;
      newCount: number;
      conflictCount: number;
      unsupportedCount: number;
      reused: boolean;
    }
  | { status: "failed"; code: string };

type ManagedAuthPollSuccess = {
  id: string;
  status: "succeeded";
  accountId: string;
  accountAuthEpoch: number;
  credentialStatus: "connected";
  credentialRevision: number;
  authEpoch: number;
  catalogSync: CatalogSyncResult;
};

function isOwnedTestDatabase(value: string | undefined) {
  if (!value || process.env.INK_USE_TEST_DATABASE_URL !== "1") return false;
  try {
    const url = new URL(value);
    const databaseName = url.pathname.slice(1).toLowerCase();
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && databaseName.startsWith("ink_memory_managed_auth_")
      && databaseName.endsWith("_test");
  } catch {
    return false;
  }
}

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") {
      diagnostics.push(`requestfailed: ${request.failure()?.errorText ?? "failed"}: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

function expectSecretSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const forbidden of FORBIDDEN_SECRET_KEYS) {
    expect(serialized, `Admin/Gateway response must not expose ${forbidden}`).not.toContain(forbidden);
  }
}

async function responseJson(
  response: APIResponse,
  expectedStatus: number,
  label: string,
) {
  const body = await response.json().catch(() => ({}));
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(expectedStatus);
  expectSecretSafe(body);
  return body as { data: Record<string, unknown> };
}

async function managedStatus(
  api: APIRequestContext,
  baseURL: string,
  providerId: string,
) {
  const response = await api.get(
    `${baseURL}/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/status`,
  );
  const body = await responseJson(response, 200, "managed-auth status");
  return body.data as unknown as ManagedStatus;
}

async function createManagedProvider(
  api: APIRequestContext,
  baseURL: string,
  headers: Record<string, string>,
  input: {
    code: string;
    name: string;
    adapterKind?: "codex" | "github_copilot";
  },
) {
  const response = await api.post(`${baseURL}/api/admin/providers`, {
    headers,
    data: {
      ...input,
      adapterKind: input.adapterKind ?? "github_copilot",
      protocol: "openai",
      status: "disabled",
      timeoutMs: 5_000,
      maxRetries: 0,
      config: {},
    },
  });
  const body = await responseJson(response, 201, `create Provider ${input.code}`);
  expect(body.data).toMatchObject({
    adapter_kind: input.adapterKind ?? "github_copilot",
    base_url: null,
    credential_configured: false,
    status: "disabled",
  });
  return String(body.data.id);
}

async function createModelAndPricing(
  api: APIRequestContext,
  baseURL: string,
  headers: Record<string, string>,
  input: {
    providerId: string;
    code: string;
    upstreamModel: string;
    displayName: string;
  },
) {
  const modelResponse = await api.post(`${baseURL}/api/admin/models`, {
    headers,
    data: {
      providerId: input.providerId,
      code: input.code,
      upstreamModel: input.upstreamModel,
      displayName: input.displayName,
      contextWindow: 128_000,
      maxOutputTokens: 4_096,
      capabilities: { chat: true },
      enabled: true,
    },
  });
  const model = await responseJson(modelResponse, 201, `create model ${input.code}`);
  const modelId = String(model.data.id);
  const pricingResponse = await api.post(`${baseURL}/api/admin/pricing-rules`, {
    headers,
    data: {
      modelId,
      userTier: "free",
      inputPriceMicrousdPerMillion: 1_000,
      outputPriceMicrousdPerMillion: 2_000,
      cacheReadPriceMicrousdPerMillion: 0,
      cacheWritePriceMicrousdPerMillion: 0,
      markupBps: 0,
      discountBps: 0,
      status: "active",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  await responseJson(pricingResponse, 201, `create pricing ${input.code}`);
  return modelId;
}

async function connectAccountThroughUi(
  page: Page,
  api: APIRequestContext,
  baseURL: string,
  providerId: string,
  buttonName: "使用 GitHub 登录",
  accountLabel: string,
  expectedAccountCount: number,
) {
  const button = page.getByRole("button", { name: buttonName, exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const startResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/providers/${providerId}/managed-auth/start`)
      && response.request().method() === "POST",
  );
  const completedPollResponse = page.waitForResponse(async (response) => {
    const url = new URL(response.url());
    if (
      !/^\/api\/admin\/provider-auth-attempts\/[^/]+\/poll$/.test(url.pathname)
      || response.request().method() !== "POST"
      || response.status() !== 200
    ) {
      return false;
    }
    const body = await response.json().catch(() => null) as {
      data?: { status?: unknown };
    } | null;
    return body?.data?.status === "succeeded";
  }, { timeout: 60_000 });
  await button.click();
  expect((await startResponse).status()).toBe(201);

  const completedPoll = await completedPollResponse;
  const completedBody = await completedPoll.json() as { data: ManagedAuthPollSuccess };
  expectSecretSafe(completedBody);
  expect(completedBody.data).toMatchObject({
    status: "succeeded",
    credentialStatus: "connected",
  });

  await expect.poll(async () => {
    const view = await managedStatus(api, baseURL, providerId);
    return view.accounts.filter((account) => account.status === "connected").length;
  }, {
    message: `wait for ${accountLabel} to connect through the Device flow`,
    timeout: 45_000,
    intervals: [500, 1_000, 1_000, 1_500],
  }).toBe(expectedAccountCount);
  return completedBody.data;
}

async function providerCatalogPersistence(providerId: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{
      ready_snapshots: number;
      applied_snapshots: number;
      catalog_models: number;
      catalog_enabled_models: number;
      catalog_pricing: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM ai_provider_discovery_snapshots
           WHERE provider_id = $1 AND status = 'ready') AS ready_snapshots,
         (SELECT count(*)::integer FROM ai_provider_discovery_snapshots
           WHERE provider_id = $1 AND status = 'applied') AS applied_snapshots,
         (SELECT count(*)::integer FROM ai_models
           WHERE provider_id = $1 AND upstream_model LIKE 'copilot-discovered-%') AS catalog_models,
         (SELECT count(*)::integer FROM ai_models
           WHERE provider_id = $1 AND upstream_model LIKE 'copilot-discovered-%'
             AND enabled = TRUE) AS catalog_enabled_models,
         (SELECT count(*)::integer
            FROM ai_pricing_rules AS pricing
            JOIN ai_models AS model ON model.id = pricing.model_id
           WHERE model.provider_id = $1
             AND model.upstream_model LIKE 'copilot-discovered-%') AS catalog_pricing`,
      [providerId],
    );
    return result.rows[0]!;
  } finally {
    await pool.end();
  }
}

async function expectDuplicateAccountConflictThroughUi(
  page: Page,
  providerId: string,
) {
  await page.goto(`/admin/models/providers/${encodeURIComponent(providerId)}/edit`);
  await expect(page.getByRole("heading", { name: "编辑 Provider" })).toBeVisible();
  const startResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/providers/${providerId}/managed-auth/start`)
      && response.request().method() === "POST",
  );
  const conflictResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return /^\/api\/admin\/provider-auth-attempts\/[^/]+\/poll$/.test(url.pathname)
      && response.request().method() === "POST"
      && response.status() === 409;
  }, { timeout: 60_000 });
  await page.getByRole("button", { name: "使用 GitHub 登录", exact: true }).click();
  expect((await startResponse).status()).toBe(201);

  const conflict = await conflictResponse;
  const body = await conflict.json();
  expect(body).toMatchObject({
    error: { code: "PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS" },
  });
  expectSecretSafe(body);
  const conflictAlert = page.getByRole("alert").filter({ hasText: "已连接到 Provider" });
  await expect(conflictAlert).toHaveCount(1);
  await expect(conflictAlert).toContainText("请先在原 Provider 断开账号");
}

test.describe("configured GitHub Copilot managed authentication", () => {
  test.describe.configure({ timeout: 240_000 });
  test.skip(
    configuredProduct !== "github_copilot" || !bootstrapToken || !isOwnedTestDatabase(databaseUrl),
    "Requires the runner-owned configured Copilot harness and named disposable PostgreSQL",
  );

  test("keeps live accounts exclusive while recovering an account orphaned by a deleted Provider", async ({
    baseURL,
    context,
    page,
  }) => {
    const diagnostics = collectDiagnostics(page);
    await context.route("http://unpkg.com/react-grab/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }));

    const origin = new URL(baseURL!).origin;
    await page.goto("/admin");
    await page.getByLabel("显示名称").fill("Managed Auth Configured E2E Admin");
    await page.getByLabel("管理员邮箱").fill("managed-auth-configured@example.test");
    await page.getByLabel("初始密码").fill("Managed-auth-configured-2026!");
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    const bootstrapResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/auth/bootstrap")
        && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    expect((await bootstrapResponse).status()).toBe(201);

    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "ink_admin_session",
    );
    if (sessionCookie?.secure && origin.startsWith("http://")) {
      await context.clearCookies({ name: "ink_admin_session" });
      await context.addCookies([{
        name: sessionCookie.name,
        value: sessionCookie.value,
        url: origin,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
        expires: sessionCookie.expires,
      }]);
      await page.goto("/admin");
    }
    await expect(page).toHaveURL(/\/admin$/);
    diagnostics.length = 0;

    const api = context.request;
    const headers = { origin, "content-type": "application/json" };
    const codexProviderId = await createManagedProvider(api, baseURL!, headers, {
      code: "codex-provider-account-e2e",
      name: "Codex Provider Account E2E",
      adapterKind: "codex",
    });
    await page.goto(`/admin/models/providers/${encodeURIComponent(codexProviderId)}/edit`);
    await expect(page.getByRole("heading", { name: "Codex / ChatGPT 账号" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 ChatGPT 登录" })).toBeEnabled();
    await expect(page.getByText("认证前置未就绪：", { exact: false })).toHaveCount(0);

    const accountOneProviderId = await createManagedProvider(api, baseURL!, headers, {
      code: "copilot-account-one-e2e",
      name: "Copilot · Account One",
    });

    await page.goto(`/admin/models/providers/${encodeURIComponent(accountOneProviderId)}/edit`);
    await expect(page.getByRole("heading", { name: "编辑 Provider" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub Copilot 账号" })).toBeVisible();
    await expect(page.getByText("认证前置未就绪：", { exact: false })).toHaveCount(0);
    const accountOnePoll = await connectAccountThroughUi(
      page,
      api,
      baseURL!,
      accountOneProviderId,
      "使用 GitHub 登录",
      "managed-auth-e2e-1",
      1,
    );
    expect(accountOnePoll.catalogSync).toEqual({
      status: "failed",
      code: expect.any(String),
    });
    await expect(page).toHaveURL(
      new RegExp(`/admin/models/providers/${accountOneProviderId}/edit$`),
    );
    await expect(page.getByText("managed-auth-e2e-1", { exact: true })).toBeVisible();
    await expect(page.getByText(/^已认证(?: ·|$)/).first()).toBeVisible();
    expect(await providerCatalogPersistence(accountOneProviderId)).toEqual({
      ready_snapshots: 0,
      applied_snapshots: 0,
      catalog_models: 0,
      catalog_enabled_models: 0,
      catalog_pricing: 0,
    });

    await expect(page.getByText(
      "账号已连接，但模型目录自动同步未完成；可点击“同步模型”重试。",
      { exact: true },
    )).toBeVisible();
    const retryResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/providers/${accountOneProviderId}/discover`)
        && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "同步模型", exact: true }).click();
    const retryResult = await retryResponse;
    const retryBody = await retryResult.json() as { data: Record<string, unknown> };
    expect(retryResult.status(), `retry managed catalog: ${JSON.stringify(retryBody)}`).toBe(200);
    expectSecretSafe(retryBody);
    const retryCatalog = retryBody.data as {
      id: string;
      discoveredCount: number;
      newCount: number;
      conflictCount: number;
      unsupportedCount: number;
      reused: boolean;
    };
    expect(retryCatalog).toMatchObject({
      id: expect.any(String),
      discoveredCount: 2,
      newCount: 1,
      conflictCount: 0,
      unsupportedCount: 1,
      reused: false,
    });
    await expect(page).toHaveURL(new RegExp(
      `/admin/models/providers/${accountOneProviderId}/discover/${retryCatalog.id}$`,
    ));

    const concurrentDiscovery = await Promise.all([1, 2].map(async (sequence) => {
      const response = await api.post(
        `${baseURL}/api/admin/providers/${accountOneProviderId}/discover`,
        { headers },
      );
      const body = await responseJson(response, 200, `concurrent managed catalog ${sequence}`);
      return body.data as {
        id: string;
        discoveredCount: number;
        newCount: number;
        conflictCount: number;
        unsupportedCount: number;
        reused: boolean;
      };
    }));
    expect(concurrentDiscovery.map((catalog) => catalog.id)).toEqual([
      retryCatalog.id,
      retryCatalog.id,
    ]);
    expect(concurrentDiscovery.some((catalog) => catalog.reused)).toBe(true);
    for (const catalog of concurrentDiscovery) {
      expect(catalog).toMatchObject({
        discoveredCount: 2,
        newCount: 1,
        conflictCount: 0,
        unsupportedCount: 1,
      });
    }
    const snapshotResponse = await api.get(
      `${baseURL}/api/admin/provider-discovery/${encodeURIComponent(retryCatalog.id)}`,
    );
    const snapshotBody = await responseJson(snapshotResponse, 200, "managed catalog snapshot");
    expect(snapshotBody.data).toMatchObject({
      id: retryCatalog.id,
      provider_id: accountOneProviderId,
      status: "ready",
      diff: expect.arrayContaining([
        expect.objectContaining({
          id: "copilot-discovered-account-1",
          vendor: "anthropic",
          upstreamDialect: "openai_chat",
          gatewayCompatible: true,
          state: "new",
        }),
        expect.objectContaining({
          id: "copilot-responses-unsupported-account-1",
          vendor: "openai",
          upstreamDialect: "openai_responses",
          gatewayCompatible: false,
          state: "unsupported",
        }),
      ]),
    });
    expect(await providerCatalogPersistence(accountOneProviderId)).toEqual({
      ready_snapshots: 1,
      applied_snapshots: 0,
      catalog_models: 0,
      catalog_enabled_models: 0,
      catalog_pricing: 0,
    });

    await expect(page.getByRole("heading", { name: "模型目录差异确认" })).toBeVisible();
    await expect(page.getByRole("cell", {
      name: "copilot-discovered-account-1",
      exact: true,
    })).toBeVisible();
    await expect(page.getByLabel("选择 copilot-discovered-account-1")).toBeChecked();
    await expect(page.getByLabel("选择 copilot-responses-unsupported-account-1")).toBeDisabled();
    await expect(page.getByText("copilot-hidden-account-1", { exact: true })).toHaveCount(0);
    expectSecretSafe(await page.locator("body").innerText());
    const applyResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/providers/${accountOneProviderId}/apply-discovery`)
        && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "应用 1 个模型", exact: true }).click();
    expect((await applyResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/models\/models\?provider_id=/);
    expect(await providerCatalogPersistence(accountOneProviderId)).toEqual({
      ready_snapshots: 0,
      applied_snapshots: 1,
      catalog_models: 1,
      catalog_enabled_models: 0,
      catalog_pricing: 0,
    });

    await page.goto(`/admin/models/providers/${encodeURIComponent(accountOneProviderId)}/edit`);
    await expect(page.getByRole("button", { name: "添加其他账号" })).toHaveCount(0);
    await expect(page.getByLabel("账号绑定")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新授权" })).toBeEnabled();

    const accountOneStatus = await managedStatus(api, baseURL!, accountOneProviderId);
    expect(accountOneStatus.readiness).toMatchObject({
      authorizationReady: true,
      credentialConnected: true,
      effective: false,
    });
    expect(accountOneStatus.defaultAccount).toBeNull();
    const accountOne = accountOneStatus.accounts.find(
      (account) => account.accountLabel === "managed-auth-e2e-1",
    );
    expect(accountOne).toMatchObject({ status: "connected", usable: true });
    expect(accountOneStatus.accounts).toHaveLength(1);
    expect(accountOneStatus.resolvedAccount?.accountId).toBe(accountOne?.accountId);
    const secondAccountAttempt = await api.post(
      `${baseURL}/api/admin/providers/${accountOneProviderId}/managed-auth/start`,
      {
        headers,
        data: {
          expectedAuthEpoch: accountOneStatus.provider.authEpoch,
          idempotencyKey: "provider-one-reject-second-account-e2e",
        },
      },
    );
    const secondAccountBody = await secondAccountAttempt.json();
    expect(secondAccountAttempt.status(), JSON.stringify(secondAccountBody)).toBe(409);
    expect(secondAccountBody).toMatchObject({
      error: { code: "PROVIDER_MANAGED_ACCOUNT_ALREADY_CONNECTED" },
    });
    expectSecretSafe(secondAccountBody);

    const accountTwoProviderId = await createManagedProvider(api, baseURL!, headers, {
      code: "copilot-account-two-e2e",
      name: "Copilot · Account Two",
    });
    await page.goto(`/admin/models/providers/${encodeURIComponent(accountTwoProviderId)}/edit`);
    const accountTwoPoll = await connectAccountThroughUi(
      page,
      api,
      baseURL!,
      accountTwoProviderId,
      "使用 GitHub 登录",
      "managed-auth-e2e-2",
      1,
    );
    expect(accountTwoPoll.catalogSync).toMatchObject({
      status: "succeeded",
      snapshotId: expect.any(String),
      discoveredCount: 2,
      newCount: 1,
      conflictCount: 0,
      unsupportedCount: 1,
      reused: false,
    });
    if (accountTwoPoll.catalogSync.status !== "succeeded") {
      throw new Error("Account two automatic catalog did not return a snapshot");
    }
    await expect(page).toHaveURL(new RegExp(
      `/admin/models/providers/${accountTwoProviderId}/discover/${accountTwoPoll.catalogSync.snapshotId}$`,
    ));
    await expect(page.getByRole("heading", { name: "模型目录差异确认" })).toBeVisible();
    await expect(page.getByRole("cell", {
      name: "copilot-discovered-account-2",
      exact: true,
    })).toBeVisible();
    await expect(page.getByLabel("选择 copilot-responses-unsupported-account-2")).toBeDisabled();
    expect(await providerCatalogPersistence(accountTwoProviderId)).toEqual({
      ready_snapshots: 1,
      applied_snapshots: 0,
      catalog_models: 0,
      catalog_enabled_models: 0,
      catalog_pricing: 0,
    });
    await page.goto(`/admin/models/providers/${encodeURIComponent(accountTwoProviderId)}/edit`);
    await expect(page.getByText("managed-auth-e2e-2", { exact: true })).toBeVisible();
    const accountOneProviderStatus = await managedStatus(api, baseURL!, accountOneProviderId);
    const accountTwoProviderStatus = await managedStatus(api, baseURL!, accountTwoProviderId);
    const accountTwo = accountTwoProviderStatus.accounts.find(
      (account) => account.accountLabel === "managed-auth-e2e-2",
    );
    expect(accountTwo).toMatchObject({ status: "connected", usable: true });
    expect(accountTwoProviderStatus.accounts).toHaveLength(1);
    expect(accountOneProviderStatus.defaultAccount).toBeNull();
    expect(accountTwoProviderStatus.defaultAccount).toBeNull();
    expect(accountOneProviderStatus.resolvedAccount?.accountId).toBe(accountOne?.accountId);
    expect(accountTwoProviderStatus.resolvedAccount?.accountId).toBe(accountTwo?.accountId);

    const accountOneModelId = await createModelAndPricing(api, baseURL!, headers, {
      providerId: accountOneProviderId,
      code: "copilot-account-one-e2e-model",
      upstreamModel: "copilot-account-one-upstream",
      displayName: "Copilot Account One Model E2E",
    });
    const accountTwoModelId = await createModelAndPricing(api, baseURL!, headers, {
      providerId: accountTwoProviderId,
      code: "copilot-account-two-e2e-model",
      upstreamModel: "copilot-account-two-upstream",
      displayName: "Copilot Account Two Model E2E",
    });
    for (const providerId of [accountOneProviderId, accountTwoProviderId]) {
      const activation = await api.patch(`${baseURL}/api/admin/providers/${providerId}`, {
        headers,
        data: { status: "active" },
      });
      const body = await responseJson(activation, 200, `activate Provider ${providerId}`);
      expect(body.data).toMatchObject({
        status: "active",
        active_credential_kind: "managed_oauth",
      });
    }

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, display_name, role)
         VALUES (9201, 'managed-auth-gateway@example.test',
                 'fixture-password-hash-not-a-credential', 'Managed Auth Gateway User', 'user')`,
      );
      const platformUser = await pool.query<{ id: string }>(
        `SELECT id FROM platform_users
          WHERE source = 'ink-dream' AND external_user_id = '9201'`,
      );
      const platformUserId = String(platformUser.rows[0]?.id);
      expect(platformUserId).not.toBe("undefined");

      const planResponse = await api.post(`${baseURL}/api/admin/subscription-plans`, {
        headers,
        data: {
          code: "managed-auth-copilot-e2e-plan",
          name: "Managed Auth Copilot E2E Plan",
          description: "Disposable managed-auth Gateway allowance",
        },
      });
      const plan = await responseJson(planResponse, 201, "create subscription plan");
      const versionResponse = await api.post(`${baseURL}/api/admin/subscription-plan-versions`, {
        headers,
        data: { planId: String(plan.data.id), allowanceTokens: 100_000 },
      });
      const version = await responseJson(versionResponse, 201, "create subscription version");
      const planVersionId = String(version.data.id);
      for (const modelId of [accountOneModelId, accountTwoModelId]) {
        const entitlement = await api.post(`${baseURL}/api/admin/subscription-entitlements`, {
          headers,
          data: {
            planVersionId,
            modelId,
            gatewayScopes: ["chat:create", "models:list"],
            dailyTokenLimit: 50_000,
            monthlyTokenLimit: 100_000,
            enabled: true,
          },
        });
        await responseJson(entitlement, 201, `create entitlement ${modelId}`);
      }
      const publish = await api.post(
        `${baseURL}/api/admin/subscription-plan-versions/${planVersionId}/publish`,
        {
          headers,
          data: {
            idempotencyKey: "publish:managed-auth-copilot:e2e",
            reason: "Configured managed-auth E2E",
          },
        },
      );
      await responseJson(publish, 200, "publish subscription version");
      const subscription = await api.post(`${baseURL}/api/admin/subscriptions`, {
        headers,
        data: {
          platformUserId,
          planVersionId,
          startInTrial: false,
          idempotencyKey: "activate:managed-auth-copilot:e2e",
          reason: "Configured managed-auth E2E",
        },
      });
      await responseJson(subscription, 201, "activate subscription");

      const keyResponse = await api.post(`${baseURL}/api/admin/gateway-api-keys`, {
        headers,
        data: {
          subjectMode: "fixed_user",
          platformUserId,
          name: "managed-auth-copilot-e2e",
          scopes: ["chat:create", "models:list"],
          expiresAt: null,
        },
      });
      const keyBody = await keyResponse.json();
      expect(keyResponse.status(), JSON.stringify(keyBody)).toBe(201);
      const gatewayKey = String(keyBody.data.plaintextKey);
      expect(gatewayKey).not.toBe("undefined");

      const gatewayCases = [
        {
          model: "copilot-account-one-e2e-model",
          idempotencyKey: "managed-auth-account-one-gateway-e2e",
          expectedAccountLabel: "managed-auth-e2e-1",
          expectedAccountId: accountOne!.accountId,
          expectedDefaultRevision: null,
        },
        {
          model: "copilot-account-two-e2e-model",
          idempotencyKey: "managed-auth-account-two-gateway-e2e",
          expectedAccountLabel: "managed-auth-e2e-2",
          expectedAccountId: accountTwo!.accountId,
          expectedDefaultRevision: null,
        },
      ];
      for (const gatewayCase of gatewayCases) {
        const gatewayResponse = await api.post(`${baseURL}/v1/chat/completions`, {
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${gatewayKey}`,
            "idempotency-key": gatewayCase.idempotencyKey,
          },
          data: {
            model: gatewayCase.model,
            max_tokens: 32,
            messages: [{ role: "user", content: `resolve ${gatewayCase.model}` }],
          },
        });
        const gatewayBody = await responseJson(
          gatewayResponse,
          200,
          `Gateway ${gatewayCase.model}`,
        );
        expect(gatewayBody.data).toBeUndefined();
        expect(JSON.stringify(gatewayBody)).toContain(
          `response from ${gatewayCase.expectedAccountLabel}`,
        );
      }

      const resolvedRequests = await pool.query<{
        idempotency_key: string;
        provider_managed_credential_id: string;
        provider_managed_default_revision: number | null;
        status: string;
        outcome: string;
      }>(
        `SELECT idempotency_key, provider_managed_credential_id,
                provider_managed_default_revision, status, outcome
           FROM gateway_requests
          WHERE idempotency_key = ANY($1::text[])
          ORDER BY idempotency_key`,
        [gatewayCases.map((gatewayCase) => gatewayCase.idempotencyKey)],
      );
      expect(resolvedRequests.rows).toHaveLength(2);
      for (const gatewayCase of gatewayCases) {
        const row = resolvedRequests.rows.find(
          (candidate) => candidate.idempotency_key === gatewayCase.idempotencyKey,
        );
        expect(row).toMatchObject({
          provider_managed_credential_id: gatewayCase.expectedAccountId,
          provider_managed_default_revision: gatewayCase.expectedDefaultRevision,
          status: "settled",
          outcome: "succeeded",
        });
      }

      const apiBodies = [
        await managedStatus(api, baseURL!, accountOneProviderId),
        await managedStatus(api, baseURL!, accountTwoProviderId),
        resolvedRequests.rows,
      ];
      apiBodies.forEach(expectSecretSafe);
      const bodyText = await page.locator("body").innerText();
      for (const forbidden of FORBIDDEN_SECRET_KEYS) expect(bodyText).not.toContain(forbidden);
      expect(bodyText).not.toContain(gatewayKey);

      const orphanFixture = await pool.query<{
        provider_status: string;
        provider_managed_credential_id: string;
        credential_status: string;
        credential_provider_id: string;
        envelope_present: boolean;
      }>(
        `WITH tombstoned AS (
           UPDATE ai_providers
              SET status = 'deleted', updated_at = NOW()
            WHERE id = $1 AND status = 'active' AND managed_credential_id = $2
          RETURNING id, status, adapter_kind, managed_credential_id
         )
         SELECT tombstoned.status AS provider_status,
                tombstoned.managed_credential_id AS provider_managed_credential_id,
                credential.status AS credential_status,
                credential.provider_id AS credential_provider_id,
                (credential.bundle_format_version IS NOT NULL
                  AND credential.bundle_key_id IS NOT NULL
                  AND credential.bundle_ciphertext IS NOT NULL
                  AND credential.bundle_nonce IS NOT NULL
                  AND credential.bundle_tag IS NOT NULL) AS envelope_present
           FROM tombstoned
           JOIN ai_provider_managed_credentials AS credential
             ON credential.id = tombstoned.managed_credential_id
            AND credential.provider_id = tombstoned.id
            AND credential.adapter_kind = tombstoned.adapter_kind`,
        [accountTwoProviderId, accountTwo!.accountId],
      );
      expect(orphanFixture.rows).toEqual([expect.objectContaining({
        provider_status: "deleted",
        provider_managed_credential_id: accountTwo!.accountId,
        credential_status: "connected",
        credential_provider_id: accountTwoProviderId,
        envelope_present: true,
      })]);

      const recoveryProviderId = await createManagedProvider(api, baseURL!, headers, {
        code: "copilot-deleted-owner-recovery-e2e",
        name: "Copilot · Deleted Owner Recovery",
      });
      await page.goto(`/admin/models/providers/${encodeURIComponent(recoveryProviderId)}/edit`);
      await connectAccountThroughUi(
        page,
        api,
        baseURL!,
        recoveryProviderId,
        "使用 GitHub 登录",
        "managed-auth-e2e-2",
        1,
      );
      const recoveryStatus = await managedStatus(api, baseURL!, recoveryProviderId);
      expect(recoveryStatus.accounts).toHaveLength(1);
      const recoveredAccount = recoveryStatus.accounts.find(
        (account) => account.accountLabel === "managed-auth-e2e-2",
      );
      expect(recoveredAccount).toMatchObject({
        status: "connected",
        accountLabel: "managed-auth-e2e-2",
        usable: true,
      });
      expect(recoveryStatus.resolvedAccount?.accountId).toBe(recoveredAccount?.accountId);
      const recoveredAccountId = recoveredAccount?.accountId;
      if (!recoveredAccountId) throw new Error("Recovered Provider did not expose its account id");
      expect(recoveredAccountId).not.toBe(accountTwo!.accountId);

      const retiredOrphan = await pool.query<{
        provider_status: string;
        provider_managed_credential_id: string | null;
        provider_active_credential_kind: string;
        credential_status: string;
        credential_provider_id: string | null;
        credential_revision: number;
        credential_auth_epoch: number;
        envelope_erased: boolean;
        lease_erased: boolean;
        scopes_erased: boolean;
        revocation_status: string | null;
        disconnected: boolean;
      }>(
        `SELECT provider.status AS provider_status,
                provider.managed_credential_id AS provider_managed_credential_id,
                provider.active_credential_kind AS provider_active_credential_kind,
                credential.status AS credential_status,
                credential.provider_id AS credential_provider_id,
                credential.revision AS credential_revision,
                credential.auth_epoch AS credential_auth_epoch,
                (credential.bundle_format_version IS NULL
                  AND credential.bundle_key_id IS NULL
                  AND credential.bundle_ciphertext IS NULL
                  AND credential.bundle_nonce IS NULL
                  AND credential.bundle_tag IS NULL) AS envelope_erased,
                (credential.refresh_lease_id IS NULL
                  AND credential.refresh_lease_expires_at IS NULL) AS lease_erased,
                cardinality(credential.granted_scopes) = 0 AS scopes_erased,
                credential.revocation_status,
                credential.disconnected_at IS NOT NULL AS disconnected
           FROM ai_providers AS provider
           JOIN ai_provider_managed_credentials AS credential ON credential.id = $2
          WHERE provider.id = $1`,
        [accountTwoProviderId, accountTwo!.accountId],
      );
      expect(retiredOrphan.rows).toEqual([expect.objectContaining({
        provider_status: "deleted",
        provider_managed_credential_id: null,
        provider_active_credential_kind: "none",
        credential_status: "disconnected",
        credential_provider_id: null,
        credential_revision: 2,
        credential_auth_epoch: 2,
        envelope_erased: true,
        lease_erased: true,
        scopes_erased: true,
        revocation_status: "not_attempted",
        disconnected: true,
      })]);

      const recoveredCredential = await pool.query<{
        provider_id: string;
        status: string;
        account_label: string;
        envelope_present: boolean;
      }>(
        `SELECT provider_id, status, account_label,
                (bundle_format_version IS NOT NULL
                  AND bundle_key_id IS NOT NULL
                  AND bundle_ciphertext IS NOT NULL
                  AND bundle_nonce IS NOT NULL
                  AND bundle_tag IS NOT NULL) AS envelope_present
           FROM ai_provider_managed_credentials
          WHERE id = $1`,
        [recoveredAccountId],
      );
      expect(recoveredCredential.rows).toEqual([expect.objectContaining({
        provider_id: recoveryProviderId,
        status: "connected",
        account_label: "managed-auth-e2e-2",
        envelope_present: true,
      })]);
      const recoveryAudit = await pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata
           FROM admin_audit_logs
          WHERE resource_type = 'provider_managed_auth'
            AND resource_id = $1
            AND action = 'managed_auth_connected'
          ORDER BY created_at DESC
          LIMIT 1`,
        [recoveryProviderId],
      );
      expect(recoveryAudit.rows[0]?.metadata).toMatchObject({
        adapterKind: "github_copilot",
        accountId: recoveredAccountId,
      });

      const conflictingProviderId = await createManagedProvider(api, baseURL!, headers, {
        code: "copilot-live-owner-conflict-e2e",
        name: "Copilot · Live Owner Conflict",
      });
      await expectDuplicateAccountConflictThroughUi(page, conflictingProviderId);
      const expectedConflictDiagnostic = diagnostics.findIndex((item) =>
        item.includes("server responded with a status of 409 (Conflict)")
      );
      if (expectedConflictDiagnostic >= 0) diagnostics.splice(expectedConflictDiagnostic, 1);
      await expect(page.getByText(
        "授权已创建，请在验证页面确认账号。完成后本页会自动检查结果。",
        { exact: true },
      )).toHaveCount(0);
      const conflictingStatus = await managedStatus(api, baseURL!, conflictingProviderId);
      expect(conflictingStatus.provider).toMatchObject({
        activeCredentialKind: "none",
      });
      expect(conflictingStatus.binding.accountId).toBeNull();
      expect(conflictingStatus.accounts).toHaveLength(0);
      expect(conflictingStatus.attempt).toMatchObject({
        status: "failed",
        failureCode: "PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS",
      });
      const liveOwnerStatus = await managedStatus(api, baseURL!, accountOneProviderId);
      expect(liveOwnerStatus.provider).toMatchObject({
        status: "active",
      });
      expect(liveOwnerStatus.binding.accountId).toBe(accountOne!.accountId);
      const originalLiveAccount = liveOwnerStatus.accounts.find(
        (account) => account.accountId === accountOne!.accountId,
      );
      expect(originalLiveAccount).toMatchObject({
        accountId: accountOne!.accountId,
        accountLabel: "managed-auth-e2e-1",
        status: "connected",
        usable: true,
      });
      expect(liveOwnerStatus.resolvedAccount?.accountId).toBe(originalLiveAccount?.accountId);

      const rejectedGrant = await pool.query<{
        status: string;
        envelope_erased: boolean;
      }>(
        `SELECT status,
                (bundle_format_version IS NULL
                  AND bundle_key_id IS NULL
                  AND bundle_ciphertext IS NULL
                  AND bundle_nonce IS NULL
                  AND bundle_tag IS NULL) AS envelope_erased
           FROM ai_provider_revocation_jobs
          WHERE provider_id = $1 AND source_kind = 'attempt'
          ORDER BY created_at DESC
          LIMIT 1`,
        [conflictingProviderId],
      );
      expect(rejectedGrant.rows).toEqual([{
        status: "unsupported",
        envelope_erased: true,
      }]);
      [recoveryStatus, conflictingStatus, liveOwnerStatus, recoveryAudit.rows].forEach(
        expectSecretSafe,
      );
      const finalBodyText = await page.locator("body").innerText();
      for (const forbidden of FORBIDDEN_SECRET_KEYS) {
        expect(finalBodyText).not.toContain(forbidden);
      }
      expect(finalBodyText).not.toContain(gatewayKey);
    } finally {
      await pool.end();
    }

    expect(diagnostics).toEqual([]);
  });
});
