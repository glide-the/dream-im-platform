// [Input] Owned migrated PostgreSQL, real Admin sessions/APIs and local fake Providers.
// [Output] Usage states, revisioned same-model routing, fallback safety, streaming and ledger evidence.
// [Pos] Public production-entry technical acceptance; no real account or paid upstream call.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

test("Provider usage → routing strategy → public Gateway → immutable settlement", async ({ context, page, baseURL, playwright }) => {
  const suffix = randomUUID();
  const modes: Record<string, "success" | "reject" | "interrupt" | "timeout"> = { first: "success", second: "success" };
  const calls: string[] = [];
  let usageStatus = 200;
  let usageBody: Record<string, unknown> = { data: { usage: 1.25, usage_daily: 0, usage_weekly: 1, usage_monthly: 1.25, limit: 10, limit_remaining: 8.75 } };
  const upstream = createServer((request, response) => {
    const credential = String(request.headers.authorization ?? request.headers["x-api-key"] ?? "");
    const provider = credential.includes("second") ? "second" : "first";
    if (request.method === "GET" && request.url === "/api/v1/key") {
      response.writeHead(usageStatus, { "content-type": "application/json" }); response.end(JSON.stringify(usageBody)); return;
    }
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      calls.push(provider);
      const body = JSON.parse(raw || "{}");
      if (modes[provider] === "timeout") return;
      if (modes[provider] === "reject") { response.writeHead(503, { "content-type": "application/json" }); response.end('{"error":{"message":"capacity rejected"}}'); return; }
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        event("message_start", { message: { id: randomUUID(), type: "message", role: "assistant", model: "mock", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
        event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ok" } });
        if (modes[provider] === "interrupt") { response.end("event: content_block_delta\ndata: invalid-json\n\n"); return; }
        event("content_block_stop", { index: 0 });
        event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
        event("message_stop", {}); response.end(); return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: randomUUID(), type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], model: body.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const origin = new URL(baseURL!).origin;
  const headers = { origin, "content-type": "application/json" };
  const diagnostics: string[] = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()); });
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    expect((await anonymous.get("/api/admin/routing-policies")).status()).toBe(401);
    expect((await anonymous.post("/api/admin/providers/missing/usage", { headers, data: {} })).status()).toBe(401);
    const api = context.request;
    const credentials = { email: "routing-admin@example.test", password: "Routing-admin-2026!" };
    const bootstrap = await api.get("/api/admin/auth/bootstrap");
    if ((await bootstrap.json()).data.required) {
      expect((await api.post("/api/admin/auth/bootstrap", { headers: { ...headers, "x-admin-bootstrap-token": process.env.ADMIN_BOOTSTRAP_E2E_TOKEN! }, data: { ...credentials, displayName: "Routing Admin" } })).status()).toBe(201);
    } else expect((await api.post("/api/admin/auth/login", { headers, data: credentials })).status()).toBe(200);
    async function create(path: string, data: Record<string, unknown>, status = 201, client: APIRequestContext = api) {
      const response = await client.post(path, { headers, data });
      expect(response.status(), await response.text()).toBe(status); return (await response.json()).data;
    }
    const endpoint = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const first = await create("/api/admin/providers", { code: `routing-first-${suffix}`, name: "Routing First", protocol: "anthropic", baseUrl: endpoint, apiKey: "routing-first-secret", status: "disabled", timeoutMs: 1000, maxRetries: 0, config: { authMode: "x-api-key", usageSource: "openrouter" } });
    const second = await create("/api/admin/providers", { code: `routing-second-${suffix}`, name: "Routing Second", protocol: "anthropic", baseUrl: endpoint, apiKey: "routing-second-secret", status: "disabled", timeoutMs: 1000, maxRetries: 0, config: { authMode: "x-api-key" } });
    const model = await create("/api/admin/models", { providerId: first.id, code: `routing-alias-${suffix}`, upstreamModel: "first-model", displayName: "Routing Alias", contextWindow: 10000, maxOutputTokens: 128, capabilities: { chat: true, streaming: true }, enabled: true });
    const supply = await create("/api/admin/models", { providerId: second.id, code: `routing-supply-${suffix}`, upstreamModel: "second-model", displayName: "Routing Supply", contextWindow: 10000, maxOutputTokens: 128, capabilities: { chat: true, streaming: true }, enabled: true });
    for (const provider of [first, second]) expect((await api.patch(`/api/admin/providers/${provider.id}`, { headers, data: { status: "active", expectedAuthRevision: 1 } })).status()).toBe(200);
    await page.goto("/admin/models/providers");
    const card = page.locator("article").filter({ hasText: first.code });
    await card.getByRole("button", { name: "查询上游用量", exact: true }).click();
    await expect(card.getByText("8.75 USD", { exact: true })).toBeVisible();
    await expect(card.getByText("0 USD", { exact: true })).toBeVisible();
    usageBody = { data: { usage: 2 } };
    await card.getByRole("button", { name: "刷新上游用量" }).click();
    await expect(card.getByText("部分指标可用")).toBeVisible();
    await expect(card.getByText("2 USD", { exact: true })).toBeVisible();
    usageStatus = 403;
    await card.getByRole("button", { name: "刷新上游用量" }).click();
    await expect(card.getByText("数据已过期，显示上次成功查询")).toBeVisible();
    await expect(card.getByText("2 USD", { exact: true })).toBeVisible();
    usageStatus = 200; usageBody = { data: {} };
    const missing = await create(`/api/admin/providers/${second.id}/usage`, {}, 200);
    expect(missing.status).toBe("unsupported");
    expect(missing.metrics).toEqual([]);
    expect(JSON.stringify(await create(`/api/admin/providers/${first.id}/usage`, {}, 200))).not.toContain("routing-first-secret");
    const invalidUsage = await api.post(`/api/admin/providers/${first.id}/usage`, { headers, data: { url: "http://arbitrary.example" } });
    expect(invalidUsage.status()).toBe(400);

    const userId = (await (await api.get("/api/admin/platform-users?sort=email&order=asc")).json()).data.find((user: { external_user_id: string }) => user.external_user_id === "101").id;
    await create("/api/admin/pricing-rules", { modelId: model.id, userTier: "free", inputPriceMicrousdPerMillion: 1000000, outputPriceMicrousdPerMillion: 2000000, cacheReadPriceMicrousdPerMillion: 100000, cacheWritePriceMicrousdPerMillion: 200000, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60000).toISOString(), effectiveTo: null });
    const plan = await create("/api/admin/subscription-plans", { code: `routing-plan-${suffix}`, name: "Routing technical Plan" });
    const version = await create("/api/admin/subscription-plan-versions", { planId: plan.id, trialDays: 0, gracePeriodDays: 0, allowanceTokens: 100000 });
    await create("/api/admin/subscription-entitlements", { planVersionId: version.id, modelId: model.id, gatewayScopes: ["messages:create", "chat:create", "models:list"], requestsPerMinute: 100, dailyTokenLimit: 50000, monthlyTokenLimit: 500000, enabled: true });
    await create(`/api/admin/subscription-plan-versions/${version.id}/publish`, { idempotencyKey: `publish-${suffix}`, reason: "Routing technical verification" }, 200);
    await create("/api/admin/subscriptions", { platformUserId: userId, planVersionId: version.id, startsAt: new Date().toISOString(), startInTrial: false, idempotencyKey: `activate-${suffix}`, reason: "Routing technical verification" });
    const key = await create("/api/admin/gateway-api-keys", { subjectMode: "fixed_user", platformUserId: userId, name: "Routing technical key", scopes: ["messages:create", "chat:create", "models:list"], expiresAt: null });
    const gatewayHeaders = { "content-type": "application/json", "x-api-key": key.plaintextKey };
    async function call(stream = false, idempotencyKey = randomUUID(), openai = false) {
      calls.length = 0;
      const response = await api.post(openai ? "/v1/chat/completions" : "/v1/messages", { headers: { ...gatewayHeaders, "idempotency-key": idempotencyKey }, data: { model: model.code, max_tokens: 32, stream, messages: [{ role: "user", content: "hello" }] } });
      await response.text(); return response;
    }
    async function receipt(response: Awaited<ReturnType<typeof call>>) {
      const id = response.headers()["x-request-id"];
      expect(id).toBeTruthy();
      return (await (await api.get(`/api/admin/gateway-requests/${id}`)).json()).data;
    }
    const legacy = await call(); expect(legacy.status()).toBe(200); expect(calls).toEqual(["first"]);
    expect((await receipt(legacy)).routing_snapshot.strategy).toBe("default");
    const desired = { strategy: "ordered", allowFallbacks: true, targets: [{ providerId: first.id, upstreamModel: "first-model", weight: 1 }, { providerId: second.id, upstreamModel: "second-model", weight: 1 }] };
    let revision = 0;
    async function savePolicy(next = desired, status = "active") {
      const saved = await create("/api/admin/routing-policies", { modelId: model.id, expectedRevision: revision, status, desired: next }, 200);
      expect(saved.revision).toBe(revision + 1); revision = saved.revision; return saved;
    }
    await savePolicy();
    expect((await api.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: 0, status: "active", desired } })).status()).toBe(409);
    expect((await api.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired, actor: "forged" } })).status()).toBe(400);
    expect((await api.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired: { ...desired, targets: [{ ...desired.targets[1], upstreamModel: "unregistered" }] } } })).status()).toBe(400);
    await page.goto("/admin/routing");
    await expect(page.getByRole("heading", { name: "路由策略", level: 1, exact: true })).toBeVisible();
    await page.getByRole("row").filter({ hasText: model.code }).getByRole("button", { name: "查看 / 编辑" }).click();
    await page.getByRole("combobox", { name: "选择方式", exact: true }).selectOption("weighted");
    const savedResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/routing-policies") && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存策略", exact: true }).click();
    expect((await savedResponse).status()).toBe(200); revision++;
    await expect(page.getByRole("status").filter({ hasText: "对新请求生效" })).toBeVisible();
    await page.screenshot({ path: "test-results/provider-routing/routing-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/provider-routing/routing-mobile.png", fullPage: true });
    const weighted = await call(); expect(weighted.status()).toBe(200); expect(calls).toHaveLength(1);
    const weightedRecord = await receipt(weighted);
    expect(weightedRecord.routing_snapshot).toMatchObject({ revision, strategy: "weighted" });
    expect([first.id, second.id]).toContain(weightedRecord.provider_id);
    const effective = await api.get(`/api/admin/routing-policies/${model.id}`);
    expect((await effective.json()).data).toMatchObject({ revision, status: "active", effective: { strategy: "weighted" } });
    await savePolicy(desired, "draft");
    const draft = await call(); expect(draft.status()).toBe(200); expect(calls).toEqual(["first"]);
    expect((await receipt(draft)).routing_snapshot).toMatchObject({ revision, strategy: "default" });
    await savePolicy(desired, "disabled");
    expect((await call()).status()).toBe(200); expect(calls).toEqual(["first"]);
    await savePolicy();
    const primary = await call(); expect(primary.status()).toBe(200); expect(calls).toEqual(["first"]);
    expect((await receipt(primary)).routing_snapshot.revision).toBe(revision);
    modes.first = "reject"; modes.second = "success";
    const fallback = await call(); expect(fallback.status()).toBe(200); expect(calls).toEqual(["first", "second"]);
    const record = await receipt(fallback);
    expect(record).toMatchObject({ provider_id: second.id, resolved_model: "second-model", input_tokens: "10", output_tokens: "5", input_price_snapshot: "1000000", output_price_snapshot: "2000000", routing_snapshot: { revision } });
    expect(record.routing_attempts.map((attempt: { status: string }) => attempt.status)).toEqual(["failed", "succeeded"]);
    expect(record.routing_attempts[0]).toMatchObject({ httpStatus: 503, errorCode: "UPSTREAM_HTTP_503" });
    const ledger = (await (await api.get(`/api/admin/token-ledger?sort=request_sequence&order=asc&filter[gateway_request_id][eq]=${record.id}`)).json()).data;
    expect(ledger.map((entry: { entry_type: string }) => entry.entry_type)).toEqual(["reserve", "capture", "release"]);
    expect(Number(ledger[1].amount_tokens)).toBe(15);
    expect(Number(record.charged_microusd)).toBe(0); // Token subscription, prices remain cost snapshots.
    const replayId = randomUUID(); await call(false, replayId); const replay = await call(false, replayId); expect(replay.status()).toBe(409); expect(calls).toEqual([]);
    const stream = await call(true); expect(stream.status()).toBe(200); expect(calls).toEqual(["first", "second"]); expect((await receipt(stream)).provider_id).toBe(second.id);
    const openai = await call(false, randomUUID(), true); expect(openai.status()).toBe(200); expect(calls).toEqual(["first", "second"]);
    await savePolicy({ ...desired, allowFallbacks: false });
    const disabledFallback = await call(); expect(disabledFallback.status()).toBeGreaterThanOrEqual(500); expect(calls).toEqual(["first"]); expect(Number((await receipt(disabledFallback)).charged_microusd)).toBe(0);
    await savePolicy(); modes.second = "reject";
    const failed = await call(); expect(failed.status()).toBeGreaterThanOrEqual(500); expect(calls).toEqual(["first", "second"]); expect(Number((await receipt(failed)).charged_microusd)).toBe(0);
    modes.first = "interrupt"; modes.second = "success";
    const interrupted = await call(true); expect(calls).toEqual(["first"]); expect((await receipt(interrupted)).outcome).toBe("failed");
    modes.first = "timeout";
    const timedOut = await call(); expect(timedOut.status()).toBeGreaterThanOrEqual(500); expect(calls).toEqual(["first"]); expect((await receipt(timedOut)).status).toBe("settlement_failed");
    modes.first = "success";
    expect((await api.patch(`/api/admin/providers/${first.id}`, { headers, data: { status: "disabled", expectedAuthRevision: 2 } })).status()).toBe(200);
    const filtered = await call(); expect(filtered.status()).toBe(200); expect(calls).toEqual(["second"]);
    expect((await receipt(filtered)).routing_snapshot.excluded).toEqual([{ providerId: first.id, reason: "provider_disabled" }]);
    expect((await api.patch(`/api/admin/models/${supply.id}`, { headers, data: { enabled: false } })).status()).toBe(200);
    const incompatible = await call(); expect(incompatible.status()).toBe(503); expect(calls).toEqual([]);
    expect((await (await api.get("/v1/models", { headers: gatewayHeaders })).json()).data.find((entry: { id: string }) => entry.id === model.code).availability).toBe("maintenance");
    expect((await api.patch(`/api/admin/models/${supply.id}`, { headers, data: { enabled: true } })).status()).toBe(200);
    expect((await api.patch(`/api/admin/providers/${second.id}`, { headers, data: { status: "disabled", expectedAuthRevision: 2 } })).status()).toBe(200);
    const unavailable = await call(); expect(unavailable.status()).toBe(503); expect(calls).toEqual([]); expect((await unavailable.json()).error.code).toBe("ROUTING_NO_CANDIDATE");
    const catalog = await api.get("/v1/models", { headers: gatewayHeaders }); expect(catalog.status()).toBe(200); expect((await catalog.json()).data.find((entry: { id: string }) => entry.id === model.code).availability).toBe("maintenance");
    const audit = (await (await api.get(`/api/admin/audit-logs?filter[resource_id][eq]=${model.id}`)).json()).data;
    expect(audit.some((entry: { action: string }) => entry.action === "save_routing_policy")).toBe(true);

    const role = await create("/api/admin/admin-roles", { code: `routing-readonly-${suffix}`, name: "Routing read only", permissionCodes: ["models.read", "providers.read"] });
    await create("/api/admin/admin-users", { email: `routing-reader-${suffix}@example.test`, password: "Routing-reader-2026!", displayName: "Routing Reader", roleCodes: [role.code] });
    const reader = await playwright.request.newContext({ baseURL });
    try {
      expect((await reader.post("/api/admin/auth/login", { headers, data: { email: `routing-reader-${suffix}@example.test`, password: "Routing-reader-2026!" } })).status()).toBe(200);
      expect((await reader.get("/api/admin/routing-policies")).status()).toBe(200);
      expect((await reader.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired } })).status()).toBe(403);
      expect((await reader.post(`/api/admin/providers/${first.id}/usage`, { headers, data: {} })).status()).toBe(200);
    } finally { await reader.dispose(); }
    expect(diagnostics).toEqual([]);
  } finally {
    await anonymous.dispose(); upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});
