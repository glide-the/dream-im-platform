// [Input] Owned isolated PostgreSQL plus real Admin session/API/UI with no Provider registration environment values.
// [Output] Proof that built-in Codex metadata makes add-account ready while secrets and attempts remain absent before a click.
// [Pos] Product-default managed Provider E2E minimum; the separate TLS harness proves the complete clickable lifecycle.
// [Sync] 2026-09-04: assert Codex Device login is enabled without manual OAuth deployment fields.

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const databaseUrl = process.env.TEST_DATABASE_URL;

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
      diagnostics.push(`requestfailed: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

test.describe("Provider managed authentication product defaults", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    !bootstrapToken || !isOwnedTestDatabase(databaseUrl),
    "Requires ADMIN_BOOTSTRAP_E2E_TOKEN plus an explicitly selected, owned TEST_DATABASE_URL",
  );
  test("enables Codex Device login without deployment registration fields", async ({
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
    await page.getByLabel("显示名称").fill("Managed Auth E2E Admin");
    await page.getByLabel("管理员邮箱").fill("managed-auth-admin@example.test");
    await page.getByLabel("初始密码").fill("Managed-auth-admin-2026!");
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    const bootstrapResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/auth/bootstrap")
      && response.request().method() === "POST"
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

    const headers = { origin, "content-type": "application/json" };
    const create = await context.request.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "managed-auth-product-default-e2e",
        name: "Managed Auth Product Default E2E",
        adapterKind: "codex",
        protocol: "openai",
        status: "disabled",
        timeoutMs: 5_000,
        maxRetries: 0,
        config: {},
      },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();
    expect(created.data).toMatchObject({
      adapter_kind: "codex",
      active_credential_kind: "none",
      auth_epoch: 1,
      status: "disabled",
      base_url: null,
      credential_configured: false,
    });
    const providerId = String(created.data.id);

    const statusResponse = await context.request.get(
      `${baseURL}/api/admin/providers/${providerId}/managed-auth/status`,
    );
    expect(statusResponse.status()).toBe(200);
    expect(statusResponse.headers()["cache-control"]).toContain("no-store");
    const statusBody = await statusResponse.json();
    expect(statusBody.data).toMatchObject({
      provider: {
        id: providerId,
        adapterKind: "codex",
        status: "disabled",
        activeCredentialKind: "none",
        authEpoch: 1,
      },
      readiness: {
        codeSupported: true,
        clientRegistrationConfigured: true,
        authorizationReady: true,
        credentialConnected: false,
        effective: false,
      },
      credential: null,
      attempt: null,
    });

    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const attempts = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ai_provider_auth_attempts WHERE provider_id = $1",
        [providerId],
      );
      expect(attempts.rows[0]?.count).toBe("0");
    } finally {
      await pool.end();
    }

    const serialized = JSON.stringify({ created, statusBody });
    for (const forbidden of [
      "device_code",
      "access_token",
      "refresh_token",
      "sourceAccessToken",
      "bundle_ciphertext",
      "client_secret",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await page.goto(`/admin/models/providers/${encodeURIComponent(providerId)}/edit`);
    await expect(page.getByRole("heading", { name: "编辑 Provider" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Codex / ChatGPT 账号" })).toBeVisible();
    await expect(page.getByText("尚未生效", { exact: true })).toBeVisible();
    await expect(page.getByText("账号认证", { exact: true })).toBeVisible();
    await expect(page.getByText("未认证", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 ChatGPT 登录" })).toBeEnabled();
    await expect(page.getByText("认证前置未就绪：", { exact: false })).toHaveCount(0);
    expect(diagnostics).toEqual([]);
  });
});
