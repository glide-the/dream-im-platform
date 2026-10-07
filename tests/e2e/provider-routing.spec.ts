// [Input] Owned migrated PostgreSQL, real Admin sessions/APIs and local fake Providers.
// [Output] Usage states, revisioned same-model routing, fallback safety, streaming and ledger evidence.
// [Pos] Public production-entry technical acceptance; no real account or paid upstream call.
// [Sync] 2026-10-07: prove registered upstream selection, directory states and live routing-rule/sequence previews.
// [Sync] 2026-10-07: allow cold Gateway route compilation in the client harness; Provider execution timeout stays unchanged.
// [Sync] 2026-10-07: separate read/edit and prove real health aggregates, gaps, permissions and responsive trends.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

test("Provider usage → routing strategy → public Gateway → immutable settlement", async ({ context, page, baseURL, playwright }, testInfo) => {
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
  const expectedCatalogFailures: string[] = [];
  let injectedCatalogProvider = "";
  let injectCatalogFailure = false;
  let injectHealthFailure = false;
  let injectedHealthModel = "";
  const expectedHealthFailures: string[] = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const url = new URL(message.location().url || origin);
    if (injectHealthFailure && url.pathname === `/api/admin/routing-policies/${injectedHealthModel}/health` && message.text().includes("503")) expectedHealthFailures.push(message.text());
    else if (injectCatalogFailure && url.pathname === "/api/admin/models" && url.searchParams.get("filter[provider_id][eq]") === injectedCatalogProvider && message.text().includes("503")) expectedCatalogFailures.push(message.text());
    else diagnostics.push(message.text());
  });
  page.on("response", response => {
    if (response.status() < 500) return;
    const url = new URL(response.url());
    if (injectHealthFailure && response.status() === 503 && url.pathname === `/api/admin/routing-policies/${injectedHealthModel}/health`) expectedHealthFailures.push("Injected health HTTP 503");
    else if (injectCatalogFailure && response.status() === 503 && url.pathname === "/api/admin/models" && url.searchParams.get("filter[provider_id][eq]") === injectedCatalogProvider) expectedCatalogFailures.push("Injected catalog HTTP 503");
    else diagnostics.push(`Unexpected HTTP ${response.status()} ${url.pathname}`);
  });
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    expect((await anonymous.get("/api/admin/routing-policies")).status()).toBe(401);
    expect((await anonymous.get("/api/admin/routing-policies/missing/health")).status()).toBe(401);
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
    await create("/api/admin/models", { providerId: second.id, code: `routing-disabled-${suffix}`, upstreamModel: "disabled-model", displayName: "Disabled supply", contextWindow: 10000, maxOutputTokens: 128, capabilities: { chat: true, streaming: true }, enabled: false });
    await create("/api/admin/models", { providerId: second.id, code: `routing-incompatible-${suffix}`, upstreamModel: "incompatible-model", displayName: "Incompatible supply", contextWindow: 100, maxOutputTokens: 64, capabilities: { chat: true }, enabled: true });
    const emptyProvider = await create("/api/admin/providers", { code: `routing-empty-${suffix}`, name: "Routing Empty", protocol: "anthropic", baseUrl: endpoint, apiKey: "routing-empty-secret", status: "disabled", timeoutMs: 1000, maxRetries: 0, config: { authMode: "x-api-key" } });
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
      const response = await api.post(openai ? "/v1/chat/completions" : "/v1/messages", { timeout: 120_000, headers: { ...gatewayHeaders, "idempotency-key": idempotencyKey }, data: { model: model.code, max_tokens: 32, stream, messages: [{ role: "user", content: "hello" }] } });
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
    await create("/api/admin/routing-policies", { modelId: supply.id, expectedRevision: 0, status: "active", desired: { strategy: "ordered", allowFallbacks: false, targets: [{ providerId: second.id, upstreamModel: "second-model", weight: 1 }] } }, 200);
    const emptyHealth = (await (await api.get(`/api/admin/routing-policies/${supply.id}/health?window=24h`)).json()).data;
    expect(emptyHealth.summary).toMatchObject({ requests: 0, successRate: null, latency: { samples: 0, p50Ms: null, p95Ms: null }, firstToken: { samples: 0, p50Ms: null } });
    expect(emptyHealth.timeline.every((point: { requests: number; successRate: number | null }) => point.requests === 0 && point.successRate === null)).toBe(true);
    expect((await api.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: 0, status: "active", desired } })).status()).toBe(409);
    expect((await api.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired, actor: "forged" } })).status()).toBe(400);
    expect((await api.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired: { ...desired, targets: [{ ...desired.targets[1], upstreamModel: "unregistered" }] } } })).status()).toBe(400);
    await page.goto("/admin/routing");
    await expect(page.getByRole("heading", { name: "路由策略", level: 1, exact: true })).toBeVisible();
    const policyRow = page.getByRole("row").filter({ hasText: model.code });
    await expect(policyRow.getByRole("button", { name: "查看", exact: true })).toBeVisible();
    await expect(policyRow.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await expect(policyRow.getByRole("button", { name: "查看 / 编辑", exact: true })).toHaveCount(0);
    await policyRow.getByRole("button", { name: "查看", exact: true }).click();
    const healthView = page.getByRole("region", { name: "路由策略查看", exact: true });
    await expect(healthView.getByRole("heading", { name: "可用性", exact: true })).toBeVisible();
    await expect(healthView.getByRole("button", { name: "保存策略", exact: true })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "路由策略编辑", exact: true })).toHaveCount(0);
    await expect(healthView.getByText("Routing First", { exact: true })).toBeVisible();
    await expect(healthView.getByText("暂无观测", { exact: true })).toBeVisible();
    const initialHealthResponse = await api.get(`/api/admin/routing-policies/${model.id}/health?window=3d`);
    expect(initialHealthResponse.status(), await initialHealthResponse.text()).toBe(200);
    const initialHealth = (await initialHealthResponse.json()).data;
    expect(initialHealth.summary).toMatchObject({ requests: 1, succeeded: 1, failed: 0, successRate: 100, recovered: 0, firstToken: { samples: 0, p50Ms: null } });
    expect(initialHealth.timeline).toHaveLength(72);
    expect(initialHealth.timeline.filter((point: { requests: number }) => point.requests === 0).every((point: { successRate: number | null }) => point.successRate === null)).toBe(true);
    expect(initialHealth.providers.find((provider: { providerId: string }) => provider.providerId === second.id)).toMatchObject({ requests: 0, successRate: null, lastObservedAt: null });
    await healthView.getByRole("button", { name: "编辑策略", exact: true }).click();
    const firstTarget = page.getByRole("group", { name: "候选 1", exact: true });
    const secondTarget = page.getByRole("group", { name: "候选 2", exact: true });
    const preview = page.getByRole("region", { name: "保存后的预期请求规则", exact: true });
    await expect(firstTarget.getByRole("combobox", { name: "上游型号", exact: true })).toHaveValue("first-model");
    await expect(secondTarget.getByRole("combobox", { name: "上游型号", exact: true })).toHaveValue("second-model");
    await expect(secondTarget.getByRole("combobox", { name: "上游型号", exact: true })).toBeEnabled();
    await expect(secondTarget.getByRole("textbox", { name: "上游型号", exact: true })).toHaveCount(0);
    await expect(secondTarget.locator("option[value='disabled-model']")).toHaveCount(0);
    await expect(secondTarget.locator("option[value='incompatible-model']")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "允许明确上游拒绝后的后备选择" }).uncheck();
    await expect(preview.getByText("后备关闭：首选上游失败后直接结束，不再调用其他 Provider。")).toBeVisible();
    await expect(preview.getByText("未保存的编辑预览")).toBeVisible();
    await expect(page.getByText(/当前生效规则.*允许明确拒绝后的后备/)).toBeVisible();
    await page.getByRole("checkbox", { name: "允许明确上游拒绝后的后备选择" }).check();
    await firstTarget.getByRole("button", { name: "下移", exact: true }).click();
    await expect(preview.getByText(/按序选择首个可用候选：Routing Second → Routing First/)).toBeVisible();
    await firstTarget.getByRole("button", { name: "下移", exact: true }).click();
    await page.getByRole("combobox", { name: "策略状态", exact: true }).selectOption("draft");
    await expect(preview.getByText("草稿或停用不参与路由，新请求使用默认 Provider。")).toBeVisible();
    await expect(preview.getByText("Routing Second · second-model")).toHaveCount(0);
    await page.getByRole("combobox", { name: "策略状态", exact: true }).selectOption("active");
    await secondTarget.getByRole("combobox", { name: "Provider", exact: true }).selectOption(emptyProvider.id);
    await expect(secondTarget.getByRole("combobox", { name: "上游型号", exact: true })).toHaveValue("");
    await expect(secondTarget.getByText("没有符合能力要求的已启用型号，请先在模型管理中登记并启用。")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存策略", exact: true })).toBeDisabled();
    // Only browser GETs for this owned empty Provider are mocked; writes and all Gateway journeys remain production entries.
    injectedCatalogProvider = emptyProvider.id;
    const pagedModels = Array.from({ length: 51 }, (_, index) => ({ ...model, id: `catalog-${index}`, provider_id: emptyProvider.id, code: `catalog-${String(index).padStart(2, "0")}`, upstream_model: `catalog-${String(index).padStart(2, "0")}`, enabled: true }));
    await page.route("**/api/admin/models?**", async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || url.searchParams.get("filter[provider_id][eq]") !== emptyProvider.id) { await route.fallback(); return; }
      if (injectCatalogFailure) { await route.fulfill({ status: 503, json: { error: { code: "CATALOG_FIXTURE_UNAVAILABLE", message: "Owned catalog temporarily unavailable" } } }); return; }
      const start = (Number(url.searchParams.get("page")) - 1) * 50;
      await route.fulfill({ json: { data: pagedModels.slice(start, start + 50), meta: { total: pagedModels.length } } });
    });
    injectCatalogFailure = true;
    await secondTarget.getByRole("textbox", { name: "搜索上游型号", exact: true }).fill("catalog");
    await expect(secondTarget.getByRole("alert")).toContainText("上游模型目录读取失败", { timeout: 15000 });
    injectCatalogFailure = false;
    await secondTarget.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(secondTarget.locator("option[value='catalog-00']")).toHaveCount(1);
    await secondTarget.getByRole("navigation", { name: "上游型号分页", exact: true }).getByRole("button", { name: "下一页", exact: true }).click();
    await expect(secondTarget.locator("option[value='catalog-50']")).toHaveCount(1);
    await secondTarget.getByRole("combobox", { name: "上游型号", exact: true }).selectOption("catalog-50");
    await secondTarget.getByRole("combobox", { name: "Provider", exact: true }).selectOption(second.id);
    await expect(secondTarget.getByRole("combobox", { name: "上游型号", exact: true })).toHaveValue("");
    await secondTarget.getByRole("combobox", { name: "上游型号", exact: true }).selectOption("second-model");
    expect(expectedCatalogFailures.length).toBeGreaterThan(0);
    await page.getByRole("combobox", { name: "选择方式", exact: true }).selectOption("weighted");
    await secondTarget.getByRole("spinbutton", { name: "权重", exact: true }).fill("3");
    await expect(preview.getByText("权重 1 · 首选占比 25%")).toBeVisible();
    await expect(preview.getByText("权重 3 · 首选占比 75%")).toBeVisible();
    await expect(page.getByRole("img", { name: "用户请求的路由与计费时序", exact: true })).toBeVisible();
    const savedResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/routing-policies") && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存策略", exact: true }).click();
    expect((await savedResponse).status()).toBe(200); revision++;
    await expect(page.getByRole("status").filter({ hasText: "对新请求生效" })).toBeVisible();
    await expect(preview.getByText("与当前保存配置一致")).toBeVisible();
    await page.getByRole("region", { name: "请求规则与链路预览", exact: true }).screenshot({ path: testInfo.outputPath("routing-preview.png") });
    await page.screenshot({ path: testInfo.outputPath("routing-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("routing-mobile.png"), fullPage: true });
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

    const healthResponse = await api.get(`/api/admin/routing-policies/${model.id}/health?window=24h`);
    expect(healthResponse.status(), await healthResponse.text()).toBe(200);
    const observed = (await healthResponse.json()).data;
    const records = (await (await api.get(`/api/admin/gateway-requests?pageSize=100&filter[requested_model][eq]=${model.code}`)).json()).data;
    const routed = records.filter((entry: { routing_attempts: unknown[] }) => entry.routing_attempts.length > 0);
    const successful = routed.filter((entry: { status: string; outcome: string }) => entry.status === "settled" && entry.outcome === "succeeded");
    expect(observed.summary.requests).toBe(routed.length);
    expect(observed.summary.succeeded).toBe(successful.length);
    expect(observed.summary.recovered).toBe(successful.filter((entry: { routing_attempts: unknown[] }) => entry.routing_attempts.length > 1).length);
    expect(observed.summary.failed).toBeGreaterThan(0);
    expect(observed.summary.firstToken.samples).toBeGreaterThan(0);
    expect(observed.timeline).toHaveLength(24);
    for (const provider of observed.providers) {
      const attempts = routed.flatMap((entry: { routing_attempts: { providerId: string; status: string }[] }) => entry.routing_attempts).filter((attempt: { providerId: string }) => attempt.providerId === provider.providerId);
      expect(provider.requests).toBe(attempts.length);
      expect(provider.failed).toBe(attempts.filter((attempt: { status: string }) => attempt.status === "failed").length);
      expect(provider.succeeded).toBe(attempts.filter((attempt: { status: string }) => attempt.status === "succeeded").length);
    }
    expect(observed.providers.find((provider: { providerId: string }) => provider.providerId === first.id).failed).toBeGreaterThan(0);
    expect(JSON.stringify(observed)).not.toMatch(/routing-first-secret|routing-second-secret|plaintextKey|api_key_ciphertext|platform_user_id|response_summary/);
    expect((await api.get(`/api/admin/routing-policies/${model.id}/health?window=forever`)).status()).toBe(400);
    expect((await api.get(`/api/admin/routing-policies/${model.id}/health?window=24h&window=7d`)).status()).toBe(400);
    expect((await api.get(`/api/admin/routing-policies/${model.id}/health?extra=forged`)).status()).toBe(400);
    expect((await api.get("/api/admin/routing-policies/missing/health")).status()).toBe(404);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/routing");
    await page.getByRole("row").filter({ hasText: model.code }).getByRole("button", { name: "查看", exact: true }).click();
    await expect(healthView.getByRole("heading", { name: "Provider 链路健康", exact: true })).toBeVisible();
    await expect(healthView.getByRole("img", { name: "Gateway 执行耗时趋势图", exact: true })).toBeVisible();
    await healthView.getByRole("combobox", { name: "统计范围", exact: true }).selectOption("24h");
    await expect(healthView.getByRole("button", { name: "刷新健康数据", exact: true })).toBeEnabled();
    await healthView.getByRole("combobox", { name: "性能指标", exact: true }).selectOption("firstToken");
    await expect(healthView.getByRole("img", { name: "流式首 Token 时间趋势图", exact: true })).toBeVisible();
    await healthView.getByRole("button", { name: "刷新健康数据", exact: true }).click();
    await expect(healthView.getByRole("button", { name: "刷新健康数据", exact: true })).toBeEnabled();
    injectedHealthModel = model.id;
    await page.route(`**/api/admin/routing-policies/${model.id}/health?**`, async route => {
      if (injectHealthFailure && route.request().method() === "GET") await route.fulfill({ status: 503, json: { error: { code: "OWNED_HEALTH_UNAVAILABLE", message: "链路健康读取失败" } } });
      else await route.fallback();
    });
    injectHealthFailure = true;
    await healthView.getByRole("button", { name: "刷新健康数据", exact: true }).click();
    await expect(healthView.getByRole("alert")).toContainText("上次数据未更新");
    injectHealthFailure = false;
    await healthView.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(healthView.getByRole("alert")).toHaveCount(0);
    expect(expectedHealthFailures.length).toBeGreaterThan(0);
    await healthView.screenshot({ path: testInfo.outputPath("routing-health.png") });
    await page.screenshot({ path: testInfo.outputPath("routing-health-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("routing-health-mobile.png"), fullPage: true });
    expect((await (await api.get(`/api/admin/routing-policies/${model.id}`)).json()).data.revision).toBe(revision);
    await healthView.getByRole("button", { name: "关闭查看", exact: true }).click();
    await page.getByRole("row").filter({ hasText: supply.code }).getByRole("button", { name: "查看", exact: true }).click();
    await expect(healthView.getByText("此范围尚无上游请求观测；当前启用状态不代表持续在线。")).toBeVisible();
    await healthView.getByRole("combobox", { name: "性能指标", exact: true }).selectOption("firstToken");
    await expect(healthView.getByText("此范围暂无成功流式首 Token观测数据")).toBeVisible();
    await expect(healthView.getByRole("img")).toHaveCount(0);

    const role = await create("/api/admin/admin-roles", { code: `routing-readonly-${suffix}`, name: "Routing read only", permissionCodes: ["models.read", "providers.read"] });
    await create("/api/admin/admin-users", { email: `routing-reader-${suffix}@example.test`, password: "Routing-reader-2026!", displayName: "Routing Reader", roleCodes: [role.code] });
    const reader = await playwright.request.newContext({ baseURL });
    try {
      expect((await reader.post("/api/admin/auth/login", { headers, data: { email: `routing-reader-${suffix}@example.test`, password: "Routing-reader-2026!" } })).status()).toBe(200);
      expect((await reader.get("/api/admin/routing-policies")).status()).toBe(200);
      expect((await reader.get(`/api/admin/routing-policies/${model.id}/health`)).status()).toBe(403);
      expect((await reader.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired } })).status()).toBe(403);
      expect((await reader.post(`/api/admin/providers/${first.id}/usage`, { headers, data: {} })).status()).toBe(200);
    } finally { await reader.dispose(); }
    const healthRole = await create("/api/admin/admin-roles", { code: `routing-health-reader-${suffix}`, name: "Routing Health Reader", permissionCodes: ["models.read", "gateway.read"] });
    const healthCredentials = { email: `routing-health-reader-${suffix}@example.test`, password: "Routing-health-reader-2026!" };
    await create("/api/admin/admin-users", { ...healthCredentials, displayName: "Routing Health Reader", roleCodes: [healthRole.code] });
    const readonlyContext = await context.browser()!.newContext({ baseURL });
    try {
      expect((await readonlyContext.request.post("/api/admin/auth/login", { headers, data: healthCredentials })).status()).toBe(200);
      expect((await readonlyContext.request.get(`/api/admin/routing-policies/${model.id}/health`)).status()).toBe(200);
      expect((await readonlyContext.request.post("/api/admin/routing-policies", { headers, data: { modelId: model.id, expectedRevision: revision, status: "active", desired } })).status()).toBe(403);
      const readonlyPage = await readonlyContext.newPage();
      readonlyPage.on("pageerror", error => diagnostics.push(error.message));
      readonlyPage.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
      readonlyPage.on("response", response => { if (response.status() >= 500) diagnostics.push(`Read-only HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
      await readonlyPage.goto("/admin/routing");
      const readonlyRow = readonlyPage.getByRole("row").filter({ hasText: model.code });
      await expect(readonlyRow.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
      await readonlyRow.getByRole("button", { name: "查看", exact: true }).click();
      await expect(readonlyPage.getByRole("heading", { name: "可用性", exact: true })).toBeVisible();
      await expect(readonlyPage.getByRole("button", { name: "编辑策略", exact: true })).toHaveCount(0);
      await expect(readonlyPage.getByRole("button", { name: "保存策略", exact: true })).toHaveCount(0);
    } finally { await readonlyContext.close(); }
    expect(diagnostics).toEqual([]);
  } finally {
    await anonymous.dispose(); upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});
