// [Input] Owned isolated PostgreSQL, real Admin session/API/UI, and a local static-credential Provider mock.
// [Output] Focused proof of unverified disabled creation, validated activation/rotation, failure preservation, CAS, and secret non-echo.
// [Pos] Provider credential lifecycle E2E; it exercises public production entry points without OAuth or test-only server branches.
// [Sync] 2026-09-04: cover the review-approved static credential MVP.

import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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

test.describe("Provider static credential lifecycle", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    !bootstrapToken || !isOwnedTestDatabase(databaseUrl),
    "Requires ADMIN_BOOTSTRAP_E2E_TOKEN plus an explicit owned TEST_DATABASE_URL selected with INK_USE_TEST_DATABASE_URL=1",
  );

  let upstream: Server | undefined;
  let upstreamUrl = "";
  const observedCredentials: string[] = [];

  test.beforeAll(async () => {
    observedCredentials.length = 0;
    upstream = createServer((request, response) => {
      const credential = String(request.headers["x-api-key"] ?? "");
      observedCredentials.push(credential);
      request.resume();
      request.on("end", () => {
        if (credential === "candidate-secret-that-must-fail") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end('{"error":{"type":"authentication_error","message":"rejected"}}');
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "msg_provider_credential_e2e",
          type: "message",
          role: "assistant",
          model: "credential-lifecycle-model",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      upstream!.once("error", reject);
      upstream!.listen(0, "127.0.0.1", resolve);
    });
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    if (!upstream) return;
    await new Promise<void>((resolve, reject) => {
      upstream!.close((error) => error ? reject(error) : resolve());
    });
  });

  test("keeps the effective credential until a candidate validates", async ({
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
    await page.getByLabel("显示名称").fill("Provider Credential E2E Admin");
    await page.getByLabel("管理员邮箱").fill("provider-credential-admin@example.test");
    await page.getByLabel("初始密码").fill("Provider-credential-admin-2026!");
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

    const api = context.request;
    const headers = { origin, "content-type": "application/json" };
    const initialSecret = "effective-secret-before-rotation";
    const rotatedSecret = "effective-secret-after-rotation";
    const failedSecret = "candidate-secret-that-must-fail";
    const staleSecret = "stale-candidate-secret-never-sent";

    const rejectedActiveSecret = "active-create-secret-never-sent";
    const rejectedActiveCreate = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "active-create-rejected-e2e",
        name: "Active Create Rejected E2E",
        protocol: "anthropic",
        baseUrl: upstreamUrl,
        apiKey: rejectedActiveSecret,
        status: "active",
        timeoutMs: 5_000,
        maxRetries: 0,
        config: { authMode: "x-api-key" },
      },
    });
    expect(rejectedActiveCreate.status()).toBe(409);
    const rejectedActiveBody = await rejectedActiveCreate.json();
    expect(rejectedActiveBody).toMatchObject({
      error: { code: "PROVIDER_ACTIVE_CREATE_REQUIRES_VALIDATION_MODEL" },
    });
    expect(JSON.stringify(rejectedActiveBody)).not.toContain(rejectedActiveSecret);
    expect(observedCredentials).toEqual([]);

    const create = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: {
        code: "credential-lifecycle-e2e",
        name: "Credential Lifecycle E2E",
        protocol: "anthropic",
        baseUrl: upstreamUrl,
        apiKey: initialSecret,
        status: "disabled",
        timeoutMs: 5_000,
        maxRetries: 0,
        config: { authMode: "x-api-key" },
      },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();
    expect(created.data).toMatchObject({
      status: "disabled",
      credential_configured: true,
      auth_revision: 1,
      credential_validation_status: "unverified",
      credential_validated_at: null,
    });
    expect(JSON.stringify(created)).not.toContain(initialSecret);
    expect(observedCredentials).toEqual([]);

    const providerId = String(created.data.id);
    const model = await api.post(`${baseURL}/api/admin/models`, {
      headers,
      data: {
        providerId,
        code: "credential-lifecycle-model",
        upstreamModel: "credential-lifecycle-model",
        displayName: "Credential Lifecycle Model",
        contextWindow: 8_192,
        maxOutputTokens: 128,
        capabilities: { chat: true },
        enabled: true,
      },
    });
    expect(model.status()).toBe(201);
    const modelId = String((await model.json()).data.id);

    const activation = await api.patch(`${baseURL}/api/admin/providers/${providerId}`, {
      headers,
      data: { status: "active", expectedAuthRevision: 1 },
    });
    expect(activation.status()).toBe(200);
    const activated = await activation.json();
    expect(activated.data).toMatchObject({
      status: "active",
      auth_revision: 2,
      credential_validation_status: "valid",
    });
    expect(activated.data.credential_validated_at).toEqual(expect.any(String));
    expect(JSON.stringify(activated)).not.toContain(initialSecret);
    expect(observedCredentials).toEqual([initialSecret]);

    const rotation = await api.patch(`${baseURL}/api/admin/providers/${providerId}`, {
      headers,
      data: { apiKey: rotatedSecret, expectedAuthRevision: 2 },
    });
    expect(rotation.status()).toBe(200);
    const rotated = await rotation.json();
    expect(rotated.data).toMatchObject({
      status: "active",
      auth_revision: 3,
      credential_validation_status: "valid",
    });
    expect(rotated.data.credential_validated_at).toEqual(expect.any(String));
    expect(JSON.stringify(rotated)).not.toContain(rotatedSecret);
    expect(observedCredentials).toEqual([initialSecret, rotatedSecret]);

    const effectiveFingerprint = rotated.data.api_key_fingerprint;
    const effectiveValidatedAt = rotated.data.credential_validated_at;
    const failedRotation = await api.patch(`${baseURL}/api/admin/providers/${providerId}`, {
      headers,
      data: { apiKey: failedSecret, expectedAuthRevision: 3 },
    });
    expect(failedRotation.status()).toBe(409);
    const failedBody = await failedRotation.json();
    expect(failedBody).toMatchObject({
      error: { code: "PROVIDER_CREDENTIAL_VALIDATION_FAILED" },
    });
    expect(JSON.stringify(failedBody)).not.toContain(failedSecret);
    expect(observedCredentials).toEqual([initialSecret, rotatedSecret, failedSecret]);

    const afterFailure = await api.get(`${baseURL}/api/admin/providers/${providerId}`);
    expect(afterFailure.status()).toBe(200);
    const afterFailureBody = await afterFailure.json();
    expect(afterFailureBody.data).toMatchObject({
      status: "active",
      auth_revision: 3,
      credential_validation_status: "valid",
      credential_validated_at: effectiveValidatedAt,
      api_key_fingerprint: effectiveFingerprint,
    });
    expect(JSON.stringify(afterFailureBody)).not.toContain(failedSecret);
    expect(JSON.stringify(afterFailureBody)).not.toContain(rotatedSecret);

    const verifyEffective = await api.post(
      `${baseURL}/api/admin/models/${modelId}/validate`,
      { headers },
    );
    expect(verifyEffective.status()).toBe(200);
    await expect(verifyEffective.json()).resolves.toMatchObject({
      data: { usable: true, httpStatus: 200 },
    });
    expect(observedCredentials.at(-1)).toBe(rotatedSecret);

    const requestsBeforeStaleCandidate = observedCredentials.length;
    const staleRotation = await api.patch(`${baseURL}/api/admin/providers/${providerId}`, {
      headers,
      data: { apiKey: staleSecret, expectedAuthRevision: 2 },
    });
    expect(staleRotation.status()).toBe(409);
    const staleBody = await staleRotation.json();
    expect(staleBody).toMatchObject({
      error: { code: "PROVIDER_AUTH_REVISION_CONFLICT" },
    });
    expect(JSON.stringify(staleBody)).not.toContain(staleSecret);
    expect(observedCredentials).toHaveLength(requestsBeforeStaleCandidate);

    await page.goto(`/admin/models/providers/${encodeURIComponent(providerId)}/edit`);
    await expect(page.getByRole("heading", { name: "编辑 Provider" })).toBeVisible();
    await expect(page.getByText("已验证", { exact: true })).toBeVisible();
    await expect(page.getByText("revision 3", { exact: true })).toBeVisible();
    await expect(page.getByLabel("API Key / 静态凭据")).toHaveValue("");
    const bodyText = await page.locator("body").innerText();
    for (const secret of [
      rejectedActiveSecret,
      initialSecret,
      rotatedSecret,
      failedSecret,
      staleSecret,
    ]) {
      expect(bodyText).not.toContain(secret);
    }

    expect(diagnostics).toEqual([]);
  });
});
