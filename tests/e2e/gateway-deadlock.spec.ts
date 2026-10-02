// [Input] Named disposable PostgreSQL, real Admin/Gateway public routes and a local mock Provider.
// [Output] Concurrent short-response settlement, append-only Token conservation and Admin visibility.
// [Pos] Focused provider-free browser/API regression; real model capacity is primary-owned separately.
// [Sync] 2026-10-02: exercise the repaired production request path without obsolete subscription lifecycle expectations.
import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

test("concurrent Gateway responses settle once and remain visible in Admin", async ({ context, page, baseURL }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID();
  const upstream = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: randomUUID(), type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], model: "mock", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const api = context.request;
    const headers = { origin: new URL(baseURL!).origin, "content-type": "application/json" };
    const setup = await api.get("/api/admin/auth/bootstrap");
    expect(setup.status()).toBe(200);
    const credentials = { email: "subscription-owner@example.test", password: "Subscription-owner-2026!" };
    if ((await setup.json()).data.required) {
      const response = await api.post("/api/admin/auth/bootstrap", { headers: { ...headers, "x-admin-bootstrap-token": process.env.ADMIN_BOOTSTRAP_E2E_TOKEN! }, data: { ...credentials, displayName: "Subscription Owner" } });
      expect(response.status()).toBe(201);
    } else {
      expect((await api.post("/api/admin/auth/login", { headers, data: credentials })).status()).toBe(200);
    }
    async function create(path: string, data: Record<string, unknown>, status = 201) {
      const response = await api.post(path, { headers, data });
      expect(response.status()).toBe(status);
      return (await response.json()).data;
    }
    const users = await api.get("/api/admin/platform-users?sort=email&order=asc");
    expect(users.status()).toBe(200);
    const userId = (await users.json()).data.find((user: { external_user_id: string }) => user.external_user_id === "101").id as string;
    const provider = await create("/api/admin/providers", { code: `lock-provider-${suffix}`, name: "Lock regression Provider", protocol: "anthropic", baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, apiKey: "isolated-provider-secret", status: "disabled", timeoutMs: 5000, maxRetries: 0, config: { authMode: "x-api-key" } });
    const model = await create("/api/admin/models", { providerId: provider.id, code: `lock-model-${suffix}`, upstreamModel: "mock", displayName: "Lock regression Model", contextWindow: 10000, maxOutputTokens: 128, capabilities: { chat: true, streaming: true }, enabled: true });
    expect((await api.patch(`/api/admin/providers/${provider.id}`, { headers, data: { status: "active", expectedAuthRevision: 1 } })).status()).toBe(200);
    await create("/api/admin/pricing-rules", { modelId: model.id, userTier: "free", inputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null });
    const plan = await create("/api/admin/subscription-plans", { code: `lock-plan-${suffix}`, name: "Lock regression Plan" });
    const version = await create("/api/admin/subscription-plan-versions", { planId: plan.id, trialDays: 0, gracePeriodDays: 0, allowanceTokens: 10000 });
    await create("/api/admin/subscription-entitlements", { planVersionId: version.id, modelId: model.id, gatewayScopes: ["messages:create", "models:list"], requestsPerMinute: 30, dailyTokenLimit: 50000, monthlyTokenLimit: 500000, enabled: true });
    await create(`/api/admin/subscription-plan-versions/${version.id}/publish`, { idempotencyKey: `publish-${suffix}`, reason: "Isolated Gateway regression" }, 200);
    const subscription = await create("/api/admin/subscriptions", { platformUserId: userId, planVersionId: version.id, startsAt: new Date().toISOString(), startInTrial: false, idempotencyKey: `activate-${suffix}`, reason: "Isolated Gateway regression" });
    const key = await create("/api/admin/gateway-api-keys", { subjectMode: "fixed_user", platformUserId: userId, name: "Isolated lock regression", scopes: ["messages:create", "models:list"], expiresAt: null });
    const calls = await Promise.all(Array.from({ length: 8 }, (_, index) => api.post("/v1/messages", {
      headers: { "content-type": "application/json", "x-api-key": key.plaintextKey, "idempotency-key": `call-${suffix}-${index}` },
      data: { model: model.code, max_tokens: 32, messages: [{ role: "user", content: "hello" }] },
    })));
    for (const call of calls) {
      expect(call.status()).toBe(200);
      const requestId = call.headers()["x-request-id"];
      expect(requestId).toBeTruthy();
      const ledger = await api.get(`/api/admin/token-ledger?sort=request_sequence&order=asc&filter[gateway_request_id][eq]=${requestId}`);
      expect(ledger.status()).toBe(200);
      const rows = (await ledger.json()).data;
      expect(rows.map((row: { entry_type: string }) => row.entry_type)).toEqual(["reserve", "capture", "release"]);
      expect(Number(rows[1].amount_tokens)).toBe(15);
      expect(Number(rows[0].amount_tokens)).toBe(Number(rows[1].amount_tokens) + Number(rows[2].amount_tokens));
    }
    const allowances = await api.get(`/api/admin/subscription-allowances?filter[subscription_id][eq]=${subscription.id}`);
    expect(allowances.status()).toBe(200);
    expect((await allowances.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ reserved_tokens: "0", consumed_tokens: "120" })]));
    const diagnostics: string[] = [];
    page.on("pageerror", error => diagnostics.push(error.message));
    page.on("response", response => { if (response.status() >= 500 && new URL(response.url()).origin === new URL(baseURL!).origin) diagnostics.push(`HTTP ${response.status()}`); });
    await page.goto("/admin/gateway/requests");
    await expect(page.getByText(model.code, { exact: true }).first()).toBeVisible();
    expect(diagnostics).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  }
});
