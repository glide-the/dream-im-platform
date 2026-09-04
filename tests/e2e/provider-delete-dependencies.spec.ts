// [Input] Owned isolated PostgreSQL plus an authenticated Admin session and public Provider/Model/Pricing routes.
// [Output] Browser proof that dependent Providers are preserved while empty Providers can be deleted.
// [Pos] Focused destructive Provider E2E; the confirmation UI and all writes exercise production Admin entry points.
// [Sync] 2026-09-04: cover one-confirm deletion, Chinese dependency guidance, retained conflict state, and list refresh.

import { expect, test, type Page } from "@playwright/test";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const reuseConfiguredAdmin = process.env.INK_MANAGED_AUTH_CONFIGURED_E2E === "github_copilot";

type AdminResponse = {
  data?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
};

type JsonHttpResponse = {
  json(): Promise<unknown>;
  status(): number;
};

function isOwnedTestDatabase(value: string | undefined) {
  if (!value || process.env.INK_USE_TEST_DATABASE_URL !== "1") return false;
  try {
    const url = new URL(value);
    const databaseName = url.pathname.slice(1).toLowerCase();
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && (databaseName.includes("test") || databaseName.includes("codex"));
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

async function jsonResponse(
  response: JsonHttpResponse,
  expectedStatus: number,
  label: string,
) {
  const body = await response.json().catch(() => ({})) as AdminResponse;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(expectedStatus);
  return body;
}

test.describe("Provider dependency-aware deletion", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    !bootstrapToken || !isOwnedTestDatabase(databaseUrl),
    "Requires ADMIN_BOOTSTRAP_E2E_TOKEN plus an explicit owned TEST_DATABASE_URL selected with INK_USE_TEST_DATABASE_URL=1",
  );

  test("blocks dependent deletion and removes an empty Provider", async ({
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
    if (reuseConfiguredAdmin) {
      await page.getByLabel("管理员邮箱").fill("managed-auth-configured@example.test");
      await page.getByLabel("密码").fill("Managed-auth-configured-2026!");
      const loginResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/admin/auth/login")
        && response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "登录控制台" }).click();
      expect((await loginResponse).status()).toBe(200);
    } else {
      await page.getByLabel("显示名称").fill("Provider Delete E2E Admin");
      await page.getByLabel("管理员邮箱").fill("provider-delete-admin@example.test");
      await page.getByLabel("初始密码").fill("Provider-delete-admin-2026!");
      await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
      const bootstrapResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/admin/auth/bootstrap")
        && response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
      expect((await bootstrapResponse).status()).toBe(201);
    }

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
    const providerName = "Dependency Delete E2E";
    const providerCreate = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "dependency-delete-e2e",
        name: providerName,
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "provider-delete-secret-never-echoed",
        status: "disabled",
        timeoutMs: 5_000,
        maxRetries: 0,
        config: { authMode: "x-api-key", modelCatalogMode: "auto" },
      },
    });
    const provider = await jsonResponse(providerCreate, 201, "create Provider");
    const providerId = String(provider.data?.id);
    expect(providerId).not.toBe("undefined");
    expect(JSON.stringify(provider)).not.toContain("provider-delete-secret-never-echoed");

    const modelCreate = await api.post(`${baseURL}/api/admin/models`, {
      headers,
      data: {
        providerId,
        code: "dependency-delete-model-e2e",
        upstreamModel: "dependency-delete-model-e2e",
        displayName: "Dependency Delete Model E2E",
        contextWindow: 8_192,
        maxOutputTokens: 512,
        capabilities: { chat: true },
        enabled: false,
      },
    });
    const model = await jsonResponse(modelCreate, 201, "create Model");
    const modelId = String(model.data?.id);
    expect(modelId).not.toBe("undefined");

    const pricingCreate = await api.post(`${baseURL}/api/admin/pricing-rules`, {
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
        effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const pricing = await jsonResponse(pricingCreate, 201, "create Pricing");
    const pricingId = String(pricing.data?.id);
    expect(pricingId).not.toBe("undefined");

    const emptyProviderName = "Empty Provider Delete E2E";
    const emptyProviderCreate = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "empty-provider-delete-e2e",
        name: emptyProviderName,
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "empty-provider-delete-secret-never-echoed",
        status: "disabled",
        timeoutMs: 5_000,
        maxRetries: 0,
        config: { authMode: "x-api-key", modelCatalogMode: "auto" },
      },
    });
    const emptyProvider = await jsonResponse(emptyProviderCreate, 201, "create empty Provider");
    const emptyProviderId = String(emptyProvider.data?.id);
    expect(emptyProviderId).not.toBe("undefined");

    await page.goto("/admin/models/providers");
    const providerCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: providerName, exact: true }),
    });
    await expect(providerCard).toHaveCount(1);
    await expect(providerCard.getByText("0 / 1", { exact: true })).toBeVisible();

    await providerCard.getByRole("button", { name: "删除 Provider", exact: true }).click();
    const blockedDialog = page.getByRole("dialog", { name: "删除 Provider", exact: true });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(blockedDialog).toBeVisible();
    await expect(blockedDialog.getByRole("button", { name: "确认删除", exact: true })).toHaveCount(1);

    const blockedResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/providers/${providerId}`)
      && response.request().method() === "DELETE"
    );
    await blockedDialog.getByRole("button", { name: "确认删除", exact: true }).click();
    const blockedBody = await jsonResponse(
      await blockedResponse,
      409,
      "delete dependent Provider",
    );
    expect(blockedBody).toMatchObject({
      error: { code: "PROVIDER_DELETE_BLOCKED_BY_DEPENDENCIES" },
    });
    const dependencyAlert = blockedDialog.getByRole("alert");
    await expect(dependencyAlert).toContainText("仍有关联模型或定价");
    await expect(dependencyAlert).toContainText("请先删除 Pricing 和模型");
    // Chromium reports an expected non-2xx fetch as a console resource error.
    // The response contract and visible recovery message are asserted above.
    diagnostics.length = 0;

    const retainedProvider = await jsonResponse(
      await api.get(`${baseURL}/api/admin/providers/${providerId}`),
      200,
      "read retained Provider",
    );
    expect(retainedProvider.data).toMatchObject({ id: providerId });
    await jsonResponse(
      await api.get(`${baseURL}/api/admin/models/${modelId}`),
      200,
      "read retained Model",
    );
    await jsonResponse(
      await api.get(`${baseURL}/api/admin/pricing-rules/${pricingId}`),
      200,
      "read retained Pricing",
    );
    await expect(providerCard).toBeVisible();

    await blockedDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(blockedDialog).toBeHidden();
    const emptyProviderCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: emptyProviderName, exact: true }),
    });
    await expect(emptyProviderCard).toHaveCount(1);
    await expect(emptyProviderCard.getByText("0 / 0", { exact: true })).toBeVisible();
    await emptyProviderCard.getByRole("button", { name: "删除 Provider", exact: true }).click();
    const successDialog = page.getByRole("dialog", { name: "删除 Provider", exact: true });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(successDialog).toBeVisible();
    await expect(successDialog.getByRole("button", { name: "确认删除", exact: true })).toHaveCount(1);
    const successResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/providers/${emptyProviderId}`)
      && response.request().method() === "DELETE"
    );
    await successDialog.getByRole("button", { name: "确认删除", exact: true }).click();
    const successBody = await jsonResponse(await successResponse, 200, "delete Provider");
    expect(successBody.data).toMatchObject({ id: emptyProviderId });

    await expect(successDialog).toBeHidden();
    await expect(emptyProviderCard).toHaveCount(0);
    await expect(providerCard).toHaveCount(1);
    await jsonResponse(
      await api.get(`${baseURL}/api/admin/providers/${emptyProviderId}`),
      404,
      "read deleted Provider",
    );
    expect(diagnostics).toEqual([]);
  });
});
