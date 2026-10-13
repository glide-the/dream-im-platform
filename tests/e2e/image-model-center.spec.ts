// [Sync] 2026-10-10: verify explicit Responses Provider selection through visible create/save/reload and public Messages JSON/SSE.
// [Sync] 2026-10-10: visibly publish distinct native capabilities and verify exact-capability catalog readiness.
// [Input] Owned migrated PostgreSQL, real Admin/Gateway routes, installed Chrome, and one local OpenAI Images fake.
// [Output] End-to-end evidence for Image provider/model/pricing/auth, generation/edit, billing, records, recovery, and responsive UI.
// [Pos] Provider-free technical acceptance; it never calls a real model or writes normal business data.
// [Sync] 2026-10-09: cover Image flows and close only the test-owned Provider connections on cleanup.
// [Sync] 2026-10-09: prove edit-mask reservation counts both uploaded input images.
// [Sync] 2026-10-09: wait for the same-route query transition before asserting the model workspace.
// [Sync] 2026-10-10: prove source-free platform pricing works end to end and reports retain unknown totals.
// [Sync] 2026-10-10: cover independent center navigation, manual Image Provider admission, and nullable/free prices.
// [Sync] 2026-10-10: remove duplicate Provider summary and verify Image reference-price apply in the shared flow.
// [Sync] 2026-10-10: reject Image-center request links and verify shared logs/billing filters and safe detail.
// [Sync] 2026-10-10: verify both legacy request URLs, refresh restoration and UTC accounting boundaries.
// [Sync] 2026-10-10: include the existing daily billing report in the same non-UTC date-boundary regression.
// [Sync] 2026-10-10: target select controls by their observed accessible combobox name, not full label text including options.
// [Sync] 2026-10-10: verify narrow request tables after closing the shared filter drawer, retaining separate drawer screenshots.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { ModelsDevEntry, PricingSyncMatch } from "../../app/lib/admin/pricing-sync";

const VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SETTLEMENT_WORKER_SECRET = "image-e2e-settlement-worker-secret-2026";

const databaseUrl = process.env.TEST_DATABASE_URL;
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const isolated = databaseUrl && process.env.INK_USE_TEST_DATABASE_URL === "1"
  && /ink_gateway_deadlock_test_[a-f0-9]+_ui/.test(new URL(databaseUrl).pathname);

// Typed catalog snapshots are controlled fixture data, not a copied discovery/matching implementation.
function referenceEntry(providerId: string, modelId: string, input: string, output: string): ModelsDevEntry {
  return { key: `${providerId}/${modelId}`, providerId, providerName: providerId, modelId,
    normalizedId: modelId, modelName: modelId, releaseDate: "", inputMicrousd: input,
    outputMicrousd: output, cacheReadMicrousd: "0", cacheWriteMicrousd: "0" };
}
function snapshotMatch(id: string, code: string, entry: ModelsDevEntry, providerCode: string): PricingSyncMatch {
  return { ...entry, localModelId: id, localModelCode: code, upstreamModel: entry.modelId, providerCode, match: "exact" };
}

function browserDiagnostics(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`requestfailed: ${request.url()}`);
  });
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`http ${response.status()}: ${response.url()}`); });
  return errors;
}

async function create(api: APIRequestContext, path: string, headers: Record<string, string>, data: Record<string, unknown>, status = 201) {
  const response = await api.post(path, { headers, data });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data as Record<string, unknown>;
}

test("Image provider → model → pricing → generation/edit → settlement → safe records", async ({ context, page, baseURL, playwright }, testInfo) => {
  test.skip(!isolated || !bootstrapToken, "Requires the named disposable PostgreSQL fixture");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const providerCalls: Array<{ path: string; body: string; authorization: string }> = [];
  let slowRequestStarted: (() => void) | undefined;
  const slowStarted = new Promise<void>((resolve) => { slowRequestStarted = resolve; });
  const upstream: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://image-provider.test").pathname;
      const raw = Buffer.concat(chunks).toString("utf8");
      providerCalls.push({ path, body: raw, authorization: String(request.headers.authorization ?? "") });
      if (path === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [{ id: "image-e2e-upstream", object: "model" }] }));
        return;
      }
      if (path === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "application/json", "x-request-id": "validate-image-provider" });
        response.end(JSON.stringify({ id: "chat_validation", object: "chat.completion", created: 1, model: "image-e2e-upstream", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        return;
      }
      if (path === "/v1/responses") {
        const body = JSON.parse(raw || "{}");
        const result = { id: "resp_visible", object: "response", model: body.model, status: "completed", output: [{ id: "msg_visible", type: "message", role: "assistant", content: [{ type: "output_text", text: "Responses visible journey" }] }], usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } };
        if (body.stream) {
          response.writeHead(200, { "content-type": "text/event-stream", "x-request-id": "responses-visible-upstream" });
          response.end(`event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: result.id, model: result.model } })}\n\nevent: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "Responses visible journey" })}\n\nevent: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: result })}\n\n`);
        } else {
          response.writeHead(200, { "content-type": "application/json", "x-request-id": "responses-visible-upstream" });
          response.end(JSON.stringify(result));
        }
        return;
      }
      if (path !== "/v1/images/generations" && path !== "/v1/images/edits") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end('{"error":{"message":"not found"}}');
        return;
      }
      const prompt = path.endsWith("generations")
        ? String((JSON.parse(raw || "{}") as { prompt?: unknown }).prompt ?? "")
        : raw;
      if (prompt.includes("upstream-failure")) {
        response.writeHead(503, { "content-type": "application/json", "x-request-id": "image-upstream-failed" });
        response.end('{"error":{"message":"temporary image capacity"}}');
        return;
      }
      if (prompt.includes("usage-failure")) {
        response.writeHead(503, { "content-type": "application/json", "x-request-id": "image-usage-failed" });
        response.end(JSON.stringify({ error: { message: "failed after billing" }, usage: { total_tokens: 13, input_tokens: 3, output_tokens: 10, input_tokens_details: { text_tokens: 3, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 10 } } }));
        return;
      }
      if (prompt.includes("slow-cancel")) {
        slowRequestStarted?.();
        const timer = setTimeout(() => { if (!response.destroyed) { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); } }, 30_000);
        response.on("close", () => clearTimeout(timer));
        return;
      }
      if (prompt.includes("no-image")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ created: 1, data: [], usage: { total_tokens: 13, input_tokens: 3, output_tokens: 10, input_tokens_details: { text_tokens: 3, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 10 } } }));
        return;
      }
      if (prompt.includes("huge-usage")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ created: 1, data: [], usage: { total_tokens: 200_003, input_tokens: 3, output_tokens: 200_000, input_tokens_details: { text_tokens: 3, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 200_000 } } }));
        return;
      }
      const editing = path.endsWith("edits");
      response.writeHead(200, { "content-type": "application/json", "x-request-id": editing ? "image-edit-upstream" : "image-generation-upstream" });
      response.end(JSON.stringify({
        created: 1,
        data: [{ b64_json: VALID_PNG_BASE64 }],
        usage: editing
          ? { total_tokens: 15, input_tokens: 5, output_tokens: 10, input_tokens_details: { text_tokens: 3, image_tokens: 2 }, output_tokens_details: { text_tokens: 0, image_tokens: 10 } }
          : { total_tokens: 13, input_tokens: 3, output_tokens: 10, input_tokens_details: { text_tokens: 3, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 10 } },
      }));
    });
  });
  await new Promise<void>((resolve, reject) => { upstream!.once("error", reject); upstream!.listen(0, "127.0.0.1", resolve); });

  const diagnostics = browserDiagnostics(page);
  const anonymous = await playwright.request.newContext({ baseURL });
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const origin = new URL(baseURL!).origin;
    const headers = { origin, "content-type": "application/json" };
    expect((await anonymous.post("/v1/images/generations", { data: { model: "missing", prompt: "unauthorized" } })).status()).toBe(401);

    const api = context.request;
    const credentials = { email: "image-admin@example.test", password: "Image-admin-2026!" };
    const bootstrap = await api.get("/api/admin/auth/bootstrap");
    if ((await bootstrap.json()).data.required) {
      const created = await api.post("/api/admin/auth/bootstrap", { headers: { ...headers, "x-admin-bootstrap-token": bootstrapToken! }, data: { ...credentials, displayName: "Image E2E Admin" } });
      expect(created.status(), await created.text()).toBe(201);
    } else {
      expect((await api.post("/api/admin/auth/login", { headers, data: credentials })).status()).toBe(200);
    }

    const users = await (await api.get("/api/admin/platform-users?page=1&pageSize=100")).json();
    const platformUserId = String(users.data.find((user: { external_user_id?: string }) => user.external_user_id === "101")?.id);
    expect(platformUserId).not.toBe("undefined");
    const provider = await create(api, "/api/admin/providers", headers, {
      code: `image-openai-${suffix}`, name: "Image OpenAI E2E", adapterKind: "generic", protocol: "openai", baseUrl: upstreamUrl,
      apiKey: `image-provider-secret-${suffix}`, status: "disabled", timeoutMs: 5_000, maxRetries: 0, config: { imageApi: { kind: "openai" } },
    });
    const sourceLessModel = await create(api, "/api/admin/models", headers, {
      providerId: provider.id, code: `image-no-source-${suffix}`, upstreamModel: "image-e2e-no-source-upstream", displayName: "Image Missing Source",
      contextWindow: null, maxOutputTokens: null, imageInputTokenReservePerImage: 50, imageOutputTokenReservePerImage: 100,
      capabilities: { image_generation: true, image_edit: true }, requestHeaders: {}, enabled: false,
    });
    const sourceLessEnable = await api.patch(`/api/admin/models/${sourceLessModel.id}`, { headers, data: { enabled: true } });
    expect(sourceLessEnable.status(), await sourceLessEnable.text()).toBe(200);
    const model = await create(api, "/api/admin/models", headers, {
      providerId: provider.id, code: `image-e2e-${suffix}`, upstreamModel: "image-e2e-upstream", displayName: "Image E2E Model",
      contextWindow: null, maxOutputTokens: null, imageInputTokenReservePerImage: 50, imageOutputTokenReservePerImage: 100,
      capabilities: { image_generation: true, image_edit: true }, requestHeaders: {}, enabled: true,
    });
    const activation = await api.patch(`/api/admin/providers/${provider.id}`, {
      headers,
      data: { status: "active", expectedAuthRevision: 1 },
      timeout: 120_000,
    });
    expect(activation.status(), await activation.text()).toBe(200);
    const incompletePricing = await api.post("/api/admin/pricing-rules", { headers, data: {
      modelId: model.id, userTier: "free", inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 0,
      cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, imageInputPriceMicrousdPerMillion: null,
      imageOutputPriceMicrousdPerMillion: null, markupBps: 0, discountBps: 0, status: "active",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null,
    } });
    expect(incompletePricing.status(), await incompletePricing.text()).toBe(400);
    const missingSourcePricing = await api.post("/api/admin/pricing-rules", { headers, data: {
      modelId: model.id, userTier: "manual-reference", inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 0,
      cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, imageInputPriceMicrousdPerMillion: 2_000_000,
      imageOutputPriceMicrousdPerMillion: 3_000_000, markupBps: 0, discountBps: 0, status: "active",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null,
    } });
    expect(missingSourcePricing.status(), await missingSourcePricing.text()).toBe(201);
    const missingBasisPricing = await api.post("/api/admin/pricing-rules", { headers, data: {
      modelId: model.id, userTier: "free", inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 0,
      cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, imageInputPriceMicrousdPerMillion: 2_000_000,
      imageOutputPriceMicrousdPerMillion: 3_000_000,
      priceSourceRef: "E2E fake Provider contract", priceSourceVersion: "2026-10-09",
      markupBps: 0, discountBps: 0, status: "active",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null,
    } });
    expect(missingBasisPricing.status(), await missingBasisPricing.text()).toBe(400);
    const mismatchedBasisPricing = await api.post("/api/admin/pricing-rules", { headers, data: {
      modelId: model.id, userTier: "free", inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 0,
      cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, imageInputPriceMicrousdPerMillion: 2_000_000,
      imageOutputPriceMicrousdPerMillion: 3_000_000, imagePricingBasis: "codex_managed_usd_contract",
      priceSourceRef: "Wrong product contract", priceSourceVersion: "2026-10-09",
      markupBps: 0, discountBps: 0, status: "active",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null,
    } });
    expect(mismatchedBasisPricing.status(), await mismatchedBasisPricing.text()).toBe(400);
    const pricing = await create(api, "/api/admin/pricing-rules", headers, {
      modelId: model.id, userTier: "free", inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 0,
      cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, imageInputPriceMicrousdPerMillion: 2_000_000,
      imageOutputPriceMicrousdPerMillion: 3_000_000, markupBps: 0, discountBps: 0, status: "active",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null,
    });
    const plan = await create(api, "/api/admin/subscription-plans", headers, { code: `image-plan-${suffix}`, name: "Image E2E Plan" });
    const version = await create(api, "/api/admin/subscription-plan-versions", headers, { planId: plan.id, trialDays: 0, gracePeriodDays: 0, allowanceTokens: 100_000 });
    await create(api, "/api/admin/subscription-entitlements", headers, { planVersionId: version.id, modelId: model.id, gatewayScopes: ["images:create", "models:list"], dailyTokenLimit: 500_000, monthlyTokenLimit: 500_000, enabled: true });
    await create(api, `/api/admin/subscription-plan-versions/${version.id}/publish`, headers, { idempotencyKey: `publish-image-${suffix}`, reason: "Image technical acceptance" }, 200);
    const subscription = await create(api, "/api/admin/subscriptions", headers, { platformUserId, planVersionId: version.id, startsAt: new Date().toISOString(), startInTrial: false, idempotencyKey: `activate-image-${suffix}`, reason: "Image technical acceptance" });
    const gatewayKey = await create(api, "/api/admin/gateway-api-keys", headers, { subjectMode: "fixed_user", platformUserId, name: "Image E2E key", scopes: ["images:create", "models:list"], expiresAt: null });
    const deniedKey = await create(api, "/api/admin/gateway-api-keys", headers, { subjectMode: "fixed_user", platformUserId, name: "Image denied E2E key", scopes: ["models:list"], expiresAt: null });
    const gatewayHeaders = { "content-type": "application/json", "x-api-key": String(gatewayKey.plaintextKey) };

    const models = await fetch(`${baseURL}/v1/models`, { headers: { "x-api-key": String(gatewayKey.plaintextKey) } });
    expect(models.status).toBe(200);
    const catalogModel = (await models.json()).data.find((entry: { id?: string }) => entry.id === model.code);
    expect(catalogModel.endpoint_availability.images).toMatchObject({ callable: true, generation: true, edit: true });
    const denied = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": String(deniedKey.plaintextKey) }, body: JSON.stringify({ model: model.code, prompt: "denied" }) });
    expect(denied.status).toBe(403);

    const disabled = await api.patch(`/api/admin/models/${model.id}`, { headers, data: { enabled: false } });
    expect(disabled.status(), await disabled.text()).toBe(200);
    expect((await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: gatewayHeaders, body: JSON.stringify({ model: model.code, prompt: "disabled model" }) })).status).toBe(404);
    const reenabled = await api.patch(`/api/admin/models/${model.id}`, { headers, data: { enabled: true } });
    expect(reenabled.status(), await reenabled.text()).toBe(200);

    const generationKey = `image-generation-${suffix}`;
    const generation = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": generationKey }, body: JSON.stringify({ model: model.code, prompt: "draw a lake", n: 1 }) });
    expect(generation.status, await generation.clone().text()).toBe(200);
    const generationId = generation.headers.get("x-request-id")!;
    expect(await generation.json()).toMatchObject({ data: [{ b64_json: VALID_PNG_BASE64 }], usage: { input_tokens_details: { text_tokens: 3, image_tokens: 0 } } });

    const png = Buffer.from(VALID_PNG_BASE64, "base64");
    const editForm = new FormData();
    editForm.set("model", String(model.code)); editForm.set("prompt", "add a red hat");
    editForm.set("image", new File([png], "reference.png", { type: "image/png" }));
    editForm.set("mask", new File([png], "mask.png", { type: "image/png" }));
    const edit = await fetch(`${baseURL}/v1/images/edits`, { method: "POST", headers: { "x-api-key": String(gatewayKey.plaintextKey), "idempotency-key": `image-edit-${suffix}` }, body: editForm });
    expect(edit.status, await edit.clone().text()).toBe(200);
    const editId = edit.headers.get("x-request-id")!;
    expect(await edit.json()).toMatchObject({ data: [{ b64_json: VALID_PNG_BASE64 }] });

    const generationCalls = providerCalls.filter((call) => call.path === "/v1/images/generations").length;
    const duplicate = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": generationKey }, body: JSON.stringify({ model: model.code, prompt: "draw a lake", n: 1 }) });
    expect(duplicate.status).toBe(409);
    expect(providerCalls.filter((call) => call.path === "/v1/images/generations")).toHaveLength(generationCalls);
    const invalidEdit = new FormData(); invalidEdit.set("model", String(model.code)); invalidEdit.set("prompt", "missing reference");
    expect((await fetch(`${baseURL}/v1/images/edits`, { method: "POST", headers: { "x-api-key": String(gatewayKey.plaintextKey) }, body: invalidEdit })).status).toBe(400);

    const failed = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": `image-failure-${suffix}` }, body: JSON.stringify({ model: model.code, prompt: "upstream-failure" }) });
    expect(failed.status).toBe(502);
    const failedId = failed.headers.get("x-request-id")!;
    const noImage = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": `image-no-result-${suffix}` }, body: JSON.stringify({ model: model.code, prompt: "no-image" }) });
    expect(noImage.status).toBe(502);
    const noImageId = noImage.headers.get("x-request-id")!;
    const usageFailure = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": `image-usage-failure-${suffix}` }, body: JSON.stringify({ model: model.code, prompt: "usage-failure" }) });
    expect(usageFailure.status).toBe(502);
    const usageFailureId = usageFailure.headers.get("x-request-id")!;
    const hugeUsageKey = `image-huge-usage-${suffix}`;
    const hugeUsage = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": hugeUsageKey }, body: JSON.stringify({ model: model.code, prompt: "huge-usage" }) });
    expect(hugeUsage.status).toBe(503);
    const hugeUsageId = String((await pool.query("SELECT id FROM gateway_requests WHERE idempotency_key = $1", [hugeUsageKey])).rows[0]?.id);
    expect(hugeUsageId).not.toBe("undefined");

    const cancelKey = `image-cancel-${suffix}`;
    const controller = new AbortController();
    const cancelling = fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": cancelKey }, body: JSON.stringify({ model: model.code, prompt: "slow-cancel" }), signal: controller.signal });
    await slowStarted; controller.abort();
    await expect(cancelling).rejects.toThrow();
    await expect.poll(async () => (await pool.query("SELECT status FROM gateway_requests WHERE idempotency_key = $1", [cancelKey])).rows[0]?.status).toBe("settlement_failed");
    const cancelId = String((await pool.query("SELECT id FROM gateway_requests WHERE idempotency_key = $1", [cancelKey])).rows[0]?.id);
    const allowanceId = String((await pool.query("SELECT subscription_allowance_id FROM gateway_requests WHERE id = $1", [hugeUsageId])).rows[0]?.subscription_allowance_id);
    const allowanceVersion = Number((await pool.query("SELECT version FROM subscription_usage_allowances WHERE id = $1", [allowanceId])).rows[0]?.version);
    const granted = await api.post(`/api/admin/subscriptions/${subscription.id}/grant-tokens`, { headers, data: {
      amountTokens: 400_000, expectedAllowanceVersion: allowanceVersion,
      idempotencyKey: `image-recovery-grant-${suffix}`, reason: "Permit isolated settlement recovery verification",
    } });
    expect(granted.status(), await granted.text()).toBe(200);
    await pool.query("UPDATE gateway_requests SET completed_at = NOW() - INTERVAL '61 seconds' WHERE id = ANY($1::text[])", [[hugeUsageId, cancelId]]);
    const recovered = await api.post("/api/internal/gateway/settlements", { headers: { authorization: `Bearer ${SETTLEMENT_WORKER_SECRET}` }, data: { limit: 10 } });
    expect(recovered.status(), await recovered.text()).toBe(200);
    expect((await recovered.json()).data.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: hugeUsageId, outcome: "actual_usage_capture", capturedTokens: 200_003 }),
      expect.objectContaining({ requestId: cancelId, outcome: "conservative_capture" }),
    ]));
    const repeatedRecovery = await api.post("/api/internal/gateway/settlements", { headers: { authorization: `Bearer ${SETTLEMENT_WORKER_SECRET}` }, data: { limit: 10 } });
    expect(repeatedRecovery.status()).toBe(200);
    expect((await repeatedRecovery.json()).data.processed).toBe(0);
    const retried = await fetch(`${baseURL}/v1/images/generations`, { method: "POST", headers: { ...gatewayHeaders, "idempotency-key": `image-retry-${suffix}` }, body: JSON.stringify({ model: model.code, prompt: "retry after cancellation" }) });
    expect(retried.status, await retried.clone().text()).toBe(200);

    const persisted = await pool.query(`SELECT id, operation, status, outcome, estimated_tokens, input_text_tokens, input_image_tokens, output_text_tokens, output_image_tokens, provider_cost_microusd, charged_microusd, allowance_charged_tokens, payload_capture_status, response_summary FROM gateway_requests WHERE id = ANY($1::text[]) ORDER BY id`, [[generationId, editId, failedId, noImageId, usageFailureId, hugeUsageId, cancelId]]);
    expect(persisted.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generationId, operation: "images.generations", status: "settled", input_text_tokens: "3", input_image_tokens: "0", output_text_tokens: "0", output_image_tokens: "10", provider_cost_microusd: "33", charged_microusd: "0", payload_capture_status: "policy_disabled", response_summary: expect.objectContaining({ imageFormats: ["image/png"] }) }),
      expect.objectContaining({ id: editId, operation: "images.edits", status: "settled", estimated_tokens: "213", input_text_tokens: "3", input_image_tokens: "2", output_text_tokens: "0", output_image_tokens: "10", provider_cost_microusd: "37", charged_microusd: "0", payload_capture_status: "policy_disabled" }),
      expect.objectContaining({ id: failedId, operation: "images.generations", status: "settlement_failed", payload_capture_status: "policy_disabled", response_summary: expect.objectContaining({ usageKnown: false }) }),
      expect.objectContaining({ id: noImageId, operation: "images.generations", status: "settled", outcome: "failed", input_text_tokens: "3", output_image_tokens: "10", provider_cost_microusd: "33", payload_capture_status: "policy_disabled" }),
      expect.objectContaining({ id: usageFailureId, operation: "images.generations", status: "settled", outcome: "failed", input_text_tokens: "3", output_image_tokens: "10", provider_cost_microusd: "33", response_summary: expect.objectContaining({ usageKnown: true }) }),
      expect.objectContaining({ id: hugeUsageId, status: "settled", outcome: "failed", output_image_tokens: "200000", allowance_charged_tokens: "200003", response_summary: expect.objectContaining({ settlementResolution: "actual_usage_recovered" }) }),
      expect.objectContaining({ id: cancelId, status: "settled", outcome: "cancelled", response_summary: expect.objectContaining({ usageKnown: false, settlementResolution: "conservative_estimated_capture" }) }),
    ]));
    const payloads = await pool.query(`SELECT (SELECT count(*) FROM gateway_request_payloads WHERE gateway_request_id = ANY($1::text[])) AS requests, (SELECT count(*) FROM gateway_response_payloads WHERE gateway_request_id = ANY($1::text[])) AS responses, (SELECT count(*) FROM gateway_response_events WHERE gateway_request_id = ANY($1::text[])) AS events`, [[generationId, editId, failedId]]);
    expect(payloads.rows[0]).toEqual({ requests: "0", responses: "0", events: "0" });
    expect(providerCalls.filter((call) => call.path.startsWith("/v1/images/"))).toEqual(expect.arrayContaining([expect.objectContaining({ authorization: `Bearer image-provider-secret-${suffix}` })]));
    expect(JSON.stringify(persisted.rows)).not.toContain("draw a lake");
    expect(JSON.stringify(persisted.rows)).not.toContain(VALID_PNG_BASE64);
    const payloadRead = await api.get(`/api/admin/gateway-requests/${generationId}/payload`, { headers: { "x-gateway-payload-confirmation": "reveal" } });
    expect(payloadRead.status()).toBe(403);
    expect((await anonymous.get("/api/admin/billing-report")).status()).toBe(401);
    expect((await api.get("/api/admin/billing-report?from=invalid")).status()).toBe(400);
    const report = await api.get("/api/admin/billing-report");
    expect(report.status()).toBe(200);
    const reportBody = await report.json();
    expect(reportBody.meta).toMatchObject({ amounts: "micro-USD", totals: "known_usage_subtotal" });
    expect(reportBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ unknown_usage_requests: "2", provider_cost_microusd: "600172", charged_microusd: "0" }),
    ]));

    await context.route("**/unpkg.com/react-grab/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.goto("/admin/image-models/providers/new");
    await expect(page.getByRole("button", { name: "xAI / Grok", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "OpenAI Official", exact: true }).click();
    const presetCode = `image-openai-preset-${suffix}`;
    await page.getByLabel("Provider Code").fill(presetCode);
    await page.getByLabel("显示名称").fill("Image OpenAI Preset E2E");
    await page.getByLabel("API Endpoint").fill(upstreamUrl);
    await page.getByLabel("API Key / 静态凭据").fill(`image-preset-secret-${suffix}`);
    const presetWrite = page.waitForResponse((response) => response.url().endsWith("/api/admin/providers") && response.request().method() === "POST");
    await page.getByRole("button", { name: "添加 Provider", exact: true }).click();
    expect((await presetWrite).status()).toBe(201);
    await expect(page).toHaveURL(/\/admin\/image-models\/providers\?saved=/);
    await expect(page.getByText("有效就绪", { exact: true })).toHaveCount(0);
    await expect(page.getByText("关联图像模型", { exact: true })).toHaveCount(0);
    const presetProvider = (await pool.query("SELECT config FROM ai_providers WHERE code = $1", [presetCode])).rows[0];
    expect(presetProvider.config).toMatchObject({ imageApi: { kind: "openai" } });

    await page.goto("/admin/image-models/providers/new");
    await expect(page.getByLabel("协议").locator("option")).toHaveText(["OpenAI"]);
    const manualCode = `image-manual-provider-${suffix}`;
    await page.getByLabel("Provider Code").fill(manualCode);
    await page.getByLabel("显示名称").fill("Image Manual OpenAI E2E");
    await page.getByLabel("API Endpoint").fill(upstreamUrl);
    await page.getByLabel("API Key / 静态凭据").fill(`manual-image-secret-${suffix}`);
    await expect(page.getByLabel("其他协议扩展配置")).toHaveValue("{}");
    const manualWrite = page.waitForResponse((response) => response.url().endsWith("/api/admin/providers") && response.request().method() === "POST");
    await page.getByRole("button", { name: "添加 Provider", exact: true }).click();
    expect((await manualWrite).status()).toBe(201);
    await expect(page).toHaveURL(/\/admin\/image-models\/providers\?saved=/);
    expect((await pool.query("SELECT protocol, config FROM ai_providers WHERE code = $1", [manualCode])).rows[0]).toMatchObject({ protocol: "openai", config: { imageApi: { kind: "openai" } } });

    await page.goto(`/admin/image-models/models/${encodeURIComponent(String(model.id))}/edit`);
    await expect(page.getByRole("heading", { name: "Claude Code Runtime", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "对话", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("预留预算依据")).toHaveValue("");
    await page.getByLabel("预留预算依据").fill("Optional platform reservation audit note");
    await page.getByLabel("显示名称").fill("Image E2E Model Reviewed");
    const modelWrite = page.waitForResponse((response) => response.url().includes(`/api/admin/models/${model.id}`) && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存模型设置", exact: true }).click();
    expect((await modelWrite).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/image-models\/models\?saved=/);

    await page.goto(`/admin/image-models/pricing/new?replaces=${encodeURIComponent(String(pricing.id))}&kind=image`);
    await expect(page.getByLabel("图像价格来源类型")).toHaveValue("");
    await expect(page.getByLabel("参考价格来源")).toHaveValue("");
    await page.getByLabel("图像价格来源类型").selectOption("openai_api_usd");
    await page.getByLabel("参考价格来源").fill("Optional upstream reference");
    await page.getByLabel("依据版本").fill("2026-10-09-ui-reviewed");
    const priceWrite = page.waitForResponse((response) => response.url().endsWith("/api/admin/pricing-rules") && response.request().method() === "POST");
    await page.getByRole("button", { name: "创建价格版本", exact: true }).click();
    expect((await priceWrite).status()).toBe(201);
    await expect(page).toHaveURL(/\/admin\/image-models\/pricing\?saved=/);

    const syncButton = page.getByRole("button", { name: "↻ models.dev 同步", exact: true });
    await expect(syncButton).toBeVisible();

    await create(api, "/api/admin/pricing-rules", headers, {
      modelId: model.id, userTier: "default", inputPriceMicrousdPerMillion: 1_000_000,
      outputPriceMicrousdPerMillion: 7_000_000, cacheReadPriceMicrousdPerMillion: 1_000_000,
      cacheWritePriceMicrousdPerMillion: 2_000_000, imageInputPriceMicrousdPerMillion: 4_000_000,
      imageOutputPriceMicrousdPerMillion: 12_000_000, markupBps: 0, discountBps: 0,
      status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null,
    });
    const imageEntry: ModelsDevEntry = { ...referenceEntry("openai", "image-e2e-upstream", "2500000", "0"), kind: "image", imageOutputMicrousd: "15000000" };
    const imageMatches: PricingSyncMatch[] = [{ ...snapshotMatch(String(model.id), String(model.code), imageEntry, String(provider.code)), imageInputMicrousd: "4000000", requiresImageInput: true }];
    const syncId = `image-sync-${suffix}`;
    await pool.query(`INSERT INTO ai_pricing_sync_snapshots (id, catalog_ref, catalog_version, catalog_hash, matches, created_by, expires_at)
      VALUES ($1, 'https://models.dev/api.json', 'image-reference-e2e', 'image-reference-hash', $2::jsonb, 'e2e', now() + interval '10 minutes')`, [syncId, JSON.stringify(imageMatches)]);
    const applySyncPath = `/api/admin/pricing-sync/${syncId}/apply`;
    expect((await anonymous.post(applySyncPath, { headers, data: { modelIds: [model.id] } })).status()).toBe(401);
    expect((await api.post(applySyncPath, { headers, data: { modelIds: [model.id], imageInputPrices: [{ localModelId: "outside", microusd: 0 }] } })).status()).toBe(409);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/image-models/pricing/sync/${syncId}`);
    await expect(page.getByLabel(`${model.code} 图像输入平台价（USD / 1M Token）`)).toHaveValue("4");
    await page.screenshot({ path: testInfo.outputPath("image-pricing-review-1440x1000.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "应用 1 个价格版本", exact: true })).toBeInViewport();
    const reviewFooter = await page.locator("section.fixed footer").evaluate((footer) => {
      const rect = footer.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width, viewportHeight: window.innerHeight, viewportWidth: window.innerWidth };
    });
    expect(reviewFooter.top).toBeGreaterThanOrEqual(0);
    expect(reviewFooter.bottom).toBeLessThanOrEqual(reviewFooter.viewportHeight);
    expect(reviewFooter.width).toBeLessThanOrEqual(reviewFooter.viewportWidth);
    await testInfo.attach("image-pricing-review-footer.json", { body: JSON.stringify(reviewFooter), contentType: "application/json" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("image-pricing-review-390x844.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel("新版本生效时间").fill(await page.evaluate(() => {
      const date = new Date(Date.now() + 120_000);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }));
    const syncApply = page.waitForResponse((response) => response.url().endsWith(applySyncPath) && response.request().method() === "POST");
    await page.getByRole("button", { name: "应用 1 个价格版本", exact: true }).click();
    expect((await syncApply).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/image-models\/pricing\?synced=/);
    expect(new URL(page.url()).searchParams.get("synced")).toBe(syncId);
    const synced = (await pool.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1 AND source = 'models.dev'", [model.id])).rows[0];
    expect(synced).toMatchObject({ input_price_microusd_per_million: "2500000", output_price_microusd_per_million: "7000000", cache_read_price_microusd_per_million: "1000000", cache_write_price_microusd_per_million: "2000000", image_input_price_microusd_per_million: "4000000", image_output_price_microusd_per_million: "15000000", source_ref: "openai/image-e2e-upstream", source_metadata: { kind: "image", referenceOnly: true, imageInputSource: "platform_configured" } });
    await page.screenshot({ path: testInfo.outputPath("image-pricing-sync-1440x1000.png") });
    const priceCount = (await pool.query("SELECT count(*) AS count FROM ai_pricing_rules WHERE model_id = $1", [model.id])).rows[0].count;
    const repeatedApply = await api.post(applySyncPath, { headers, data: { modelIds: [model.id] } });
    expect(repeatedApply.status()).toBe(409);
    expect((await repeatedApply.json()).error.code).toBe("PRICING_SYNC_EXPIRED");
    expect((await pool.query("SELECT count(*) AS count FROM ai_pricing_rules WHERE model_id = $1", [model.id])).rows[0].count).toBe(priceCount);
    await page.goto(`/admin/image-models/pricing/sync/${syncId}`);
    await expect(page.getByRole("button", { name: "重新同步", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "应用 1 个价格版本", exact: true })).toBeDisabled();

    const textModel = await create(api, "/api/admin/models", headers, { providerId: provider.id, code: `text-sync-${suffix}`, upstreamModel: "text-sync-upstream", displayName: "Text pricing regression", capabilities: { chat: true }, enabled: false });
    const textCatalog: ModelsDevEntry[] = [{ ...referenceEntry("source1", "text-sync-upstream", "1000000", "2000000"), cacheReadMicrousd: "100000", cacheWriteMicrousd: "200000" }, referenceEntry("source2", "text-sync-upstream", "3000000", "4000000")];
    const textMatches: PricingSyncMatch[] = [{ ...snapshotMatch(String(textModel.id), String(textModel.code), textCatalog[0], "custom"), match: "ambiguous", candidates: textCatalog.map((item) => item.key), candidateDetails: textCatalog }];
    const textSyncId = `text-sync-${suffix}`;
    await pool.query(`INSERT INTO ai_pricing_sync_snapshots (id, catalog_ref, catalog_version, catalog_hash, matches, created_by, expires_at)
      VALUES ($1, 'https://models.dev/api.json', 'text-reference-e2e', 'text-reference-hash', $2::jsonb, 'e2e', now() + interval '10 minutes')`, [textSyncId, JSON.stringify(textMatches)]);
    await page.goto(`/admin/models/pricing/sync/${textSyncId}`);
    await expect(page.getByRole("columnheader", { name: "Cache read", exact: true })).toBeVisible();
    await expect(page.getByLabel(`${textModel.code} 图像输入平台价（USD / 1M Token）`)).toHaveCount(0);
    await page.getByRole("button", { name: `展开 ${textModel.code} 的 2 个候选`, exact: true }).click();
    await page.getByRole("radio", { name: `为 ${textModel.code} 选择 source1/text-sync-upstream`, exact: true }).check();
    const textApply = page.waitForResponse((response) => response.url().endsWith(`/api/admin/pricing-sync/${textSyncId}/apply`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "应用 1 个价格版本", exact: true }).click();
    expect((await textApply).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/models\/pricing\?synced=/);
    expect((await pool.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1", [textModel.id])).rows[0]).toMatchObject({ input_price_microusd_per_million: "1000000", output_price_microusd_per_million: "2000000", cache_read_price_microusd_per_million: "100000", cache_write_price_microusd_per_million: "200000", image_input_price_microusd_per_million: null, image_output_price_microusd_per_million: null });

    // Isolated legacy/fault fixtures prove that sync obeys the ordinary version-window contract.
    async function textSyncFixture(id: string, models: Array<{ id: string; code: string; upstream: string }>) {
      const matches: PricingSyncMatch[] = models.map((item) => snapshotMatch(item.id, item.code, referenceEntry("openai", item.upstream, "1000000", "2000000"), String(provider.code)));
      await pool.query(`INSERT INTO ai_pricing_sync_snapshots (id, catalog_ref, catalog_version, catalog_hash, matches, created_by, expires_at)
        VALUES ($1, 'https://models.dev/api.json', 'window-e2e', 'window-e2e-hash', $2::jsonb, 'e2e', now() + interval '10 minutes')`, [id, JSON.stringify(matches)]);
      return `/api/admin/pricing-sync/${id}/apply`;
    }
    const boundedUpstream = `window-bounded-${suffix}`;
    const boundedModel = await create(api, "/api/admin/models", headers, { providerId: provider.id, code: `bounded-sync-${suffix}`, upstreamModel: boundedUpstream, displayName: "Bounded window regression", capabilities: { chat: true }, enabled: false });
    await create(api, "/api/admin/pricing-rules", headers, { modelId: boundedModel.id, userTier: "default", inputPriceMicrousdPerMillion: 3_000_000, outputPriceMicrousdPerMillion: 4_000_000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: new Date(Date.now() + 600_000).toISOString() });
    const boundedBefore = (await pool.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1", [boundedModel.id])).rows;
    const boundedPath = await textSyncFixture(`bounded-sync-${suffix}`, [{ id: String(boundedModel.id), code: String(boundedModel.code), upstream: boundedUpstream }]);
    const overlap = await api.post(boundedPath, { headers, data: { modelIds: [boundedModel.id] } });
    expect(overlap.status()).toBe(409);
    expect((await overlap.json()).error.code).toBe("PRICING_WINDOW_CONFLICT");
    expect((await pool.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1", [boundedModel.id])).rows).toEqual(boundedBefore);
    expect((await pool.query("SELECT status FROM ai_pricing_sync_snapshots WHERE id = $1", [`bounded-sync-${suffix}`])).rows[0].status).toBe("ready");

    const duplicateUpstream = `window-duplicate-${suffix}`;
    const duplicateModel = await create(api, "/api/admin/models", headers, { providerId: provider.id, code: `duplicate-sync-${suffix}`, upstreamModel: duplicateUpstream, displayName: "Duplicate open window regression", capabilities: { chat: true }, enabled: false });
    const duplicatePrice = await create(api, "/api/admin/pricing-rules", headers, { modelId: duplicateModel.id, userTier: "default", inputPriceMicrousdPerMillion: 3_000_000, outputPriceMicrousdPerMillion: 4_000_000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null });
    await pool.query(`INSERT INTO ai_pricing_rules (id, model_id, user_tier, input_price_microusd_per_million, output_price_microusd_per_million, cache_read_price_microusd_per_million, cache_write_price_microusd_per_million, markup_bps, discount_bps, status, effective_from)
      SELECT $2, model_id, user_tier, input_price_microusd_per_million, output_price_microusd_per_million, cache_read_price_microusd_per_million, cache_write_price_microusd_per_million, markup_bps, discount_bps, status, effective_from FROM ai_pricing_rules WHERE id = $1`, [duplicatePrice.id, `duplicate-price-${suffix}`]);
    const duplicateBefore = (await pool.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1 ORDER BY id", [duplicateModel.id])).rows;
    const duplicatePath = await textSyncFixture(`duplicate-sync-${suffix}`, [{ id: String(duplicateModel.id), code: String(duplicateModel.code), upstream: duplicateUpstream }]);
    const duplicateWindowReply = await api.post(duplicatePath, { headers, data: { modelIds: [duplicateModel.id] } });
    expect(duplicateWindowReply.status()).toBe(409);
    expect((await duplicateWindowReply.json()).error.code).toBe("PRICING_CURRENT_VERSION_AMBIGUOUS");
    expect((await pool.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1 ORDER BY id", [duplicateModel.id])).rows).toEqual(duplicateBefore);

    const concurrentModels: Array<{ id: string; code: string; upstream: string }> = [];
    for (const label of ["a", "b"]) {
      const upstream = `window-concurrent-${label}-${suffix}`;
      const item = await create(api, "/api/admin/models", headers, { providerId: provider.id, code: `concurrent-sync-${label}-${suffix}`, upstreamModel: upstream, displayName: `Concurrent pricing ${label}`, capabilities: { chat: true }, enabled: false });
      concurrentModels.push({ id: String(item.id), code: String(item.code), upstream });
    }
    const concurrencyPaths = await Promise.all(["one", "two"].map((label) => textSyncFixture(`concurrent-sync-${label}-${suffix}`, concurrentModels)));
    const control = await pool.connect();
    try {
      await control.query("SELECT pg_advisory_lock(hashtextextended($1, 0)), pg_advisory_lock(hashtextextended($2, 0))", concurrentModels.map((item) => `${item.id}:default`));
      const applying = concurrencyPaths.map((path, index) => api.post(path, { headers, data: { modelIds: (index === 0 ? concurrentModels : [...concurrentModels].reverse()).map((item) => item.id) } }));
      await expect.poll(async () => Number((await control.query("SELECT count(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())")).rows[0].count)).toBe(2);
      await control.query("SELECT pg_advisory_unlock_all()");
      const replies = await Promise.all(applying);
      for (const reply of replies) expect(reply.status(), await reply.text()).toBe(200);
    } finally {
      await control.query("SELECT pg_advisory_unlock_all()");
      control.release();
    }
    expect((await pool.query("SELECT count(*) AS count FROM ai_pricing_rules WHERE model_id = ANY($1::text[])", [concurrentModels.map((item) => item.id)])).rows[0].count).toBe("2");
    expect((await pool.query("SELECT status FROM ai_pricing_sync_snapshots WHERE id = ANY($1::text[])", [[`concurrent-sync-one-${suffix}`, `concurrent-sync-two-${suffix}`]])).rows.map((row) => row.status)).toEqual(["applied", "applied"]);

    const generationOnly = await create(api, "/api/admin/models", headers, {
      providerId: provider.id, code: `image-generation-only-${suffix}`, upstreamModel: "image-generation-only-upstream", displayName: "Image generation-only E2E",
      imageOutputTokenReservePerImage: 100, capabilities: { image_generation: true, image_edit: false }, requestHeaders: {}, enabled: false,
    });
    await page.goto(`/admin/image-models/pricing/new?modelId=${encodeURIComponent(String(generationOnly.id))}`);
    await expect(page.getByLabel("Image Input（USD / 1M tokens）")).toHaveValue("");
    await expect(page.getByLabel("Image Output（USD / 1M tokens）")).toHaveValue("");
    await page.getByLabel("Image Output（USD / 1M tokens）").fill("0");
    const freePriceWrite = page.waitForResponse((response) => response.url().endsWith("/api/admin/pricing-rules") && response.request().method() === "POST");
    await page.getByRole("button", { name: "创建价格版本", exact: true }).click();
    const freePriceResponse = await freePriceWrite;
    expect(freePriceResponse.status(), await freePriceResponse.text()).toBe(201);
    expect((await freePriceResponse.json()).data).toMatchObject({ image_input_price_microusd_per_million: null, image_output_price_microusd_per_million: "0" });
    await expect(page).toHaveURL(/\/admin\/image-models\/pricing\?saved=/);

    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const section of ["providers", "models", "pricing"]) {
      await page.goto(`/admin/image-models/${section}`);
      await expect(page.getByRole("heading", { name: "Image 模型中心", level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Image 模型中心子导航" }).getByRole("link")).toHaveText(["Provider", "Models", "Pricing"]);
      await expect(page.locator('a[href="/admin/image-models/requests"]')).toHaveCount(0);
      await expect(page.getByRole("link", { name: "请求记录", exact: true })).toHaveCount(0);
    }
    await page.goto("/admin/image-models/requests");
    await expect(page).toHaveURL(/\/admin\/gateway\/requests$/);
    await expect(page.getByRole("heading", { name: "请求日志", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Image 模型中心子导航" })).toHaveCount(0);
    await page.goto("/admin/models/images?view=requests");
    await expect(page).toHaveURL(/\/admin\/gateway\/requests$/);
    await page.getByRole("button", { name: /展开筛选/ }).click();
    await page.getByRole("combobox", { name: "调用类型", exact: true }).selectOption("images.generations");
    await page.getByLabel("Provider", { exact: true }).fill(String(provider.code));
    await page.getByLabel("请求模型", { exact: true }).fill(String(model.code));
    const localDateTime = (offset: number) => {
      const date = new Date(Date.now() + offset);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    await page.getByLabel("开始时间", { exact: true }).fill(localDateTime(-3_600_000));
    await page.getByLabel("结束时间", { exact: true }).fill(localDateTime(60_000));
    const logFilterResponse = page.waitForResponse((response) => response.url().includes("/api/admin/gateway-requests?") && new URL(response.url()).searchParams.get("filter[operation][eq]") === "images.generations");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    const logResponse = await logFilterResponse;
    expect(logResponse.status()).toBe(200);
    const filteredLogs = (await logResponse.json()).data as Array<{ id: string; operation: string }>;
    expect(filteredLogs.length).toBeGreaterThan(0);
    expect(filteredLogs.every((row) => row.operation === "images.generations")).toBe(true);
    expect(filteredLogs.some((row) => row.id === generationId)).toBe(true);
    await expect(page.getByText(editId, { exact: true })).toHaveCount(0);
    const mainNav = page.getByRole("navigation", { name: "管理后台主导航" });
    await expect(mainNav.getByRole("heading", { name: "AI 模型中心", exact: true })).toBeVisible();
    await expect(mainNav.getByRole("heading", { name: "Image 模型中心", exact: true })).toBeVisible();
    await expect(mainNav.locator('a[href="/admin/image-models/models"]')).toBeVisible();
    await expect(page.getByText(generationId, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `查看 ${generationId} 详情` }).click();
    await expect(page.getByText("图像请求按策略永久关闭报文捕获")).toBeVisible();
    await expect(page.getByRole("button", { name: "二次确认并查看完整报文" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("image-request-detail-1440x1000.png") });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("combobox", { name: "调用类型", exact: true }).selectOption("images.edits");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.getByText(editId, { exact: true })).toBeVisible();
    await expect(page.getByText(generationId, { exact: true })).toHaveCount(0);
    await page.locator("table").locator("..").evaluate((element) => { element.scrollLeft = 0; });
    await page.screenshot({ path: testInfo.outputPath("gateway-image-logs-1440x1000.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("gateway-image-log-filters-390x844.png") });
    await page.getByRole("button", { name: "关闭筛选", exact: true }).click();
    await expect(page.getByRole("heading", { name: "请求日志", level: 1 })).toBeVisible();
    await expect(page.getByText(editId, { exact: true })).toBeVisible();
    expect(await page.locator("table").locator("..").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("gateway-image-logs-390x844.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    expect((await anonymous.get("/api/admin/usage-dashboard?operation=images.edits")).status()).toBe(401);
    expect((await anonymous.get("/api/admin/usage?filter[operation][eq]=images.edits")).status()).toBe(401);
    expect((await api.get("/api/admin/usage-dashboard?operation=images.unknown")).status()).toBe(400);
    const billingSearch = new URLSearchParams({ operation: "images.edits", providerId: String(provider.id), modelId: String(model.id) });
    const billingAggregate = await api.get(`/api/admin/usage-dashboard?${billingSearch}`);
    expect(billingAggregate.status()).toBe(200);
    const aggregate = (await billingAggregate.json()).data;
    expect(aggregate.meta.operation).toBe("images.edits");
    expect(aggregate.summary.requests).toBe("1");
    expect(aggregate.summary.provider_cost_microusd).toBe("37");
    const billingRowsResponse = page.waitForResponse((response) => response.url().includes("/api/admin/usage?") && new URL(response.url()).searchParams.get("filter[operation][eq]") === "images.edits");
    await page.goto(`/admin/billing/usage?${billingSearch}`);
    const billingRowsReply = await billingRowsResponse;
    expect(billingRowsReply.status()).toBe(200);
    const billingRows = (await billingRowsReply.json()).data;
    expect(billingRows).toHaveLength(1);
    expect(billingRows[0]).toMatchObject({ id: editId, operation: "images.edits", image_input_price_snapshot: "2000000", image_output_price_snapshot: "3000000" });
    expect(JSON.stringify(billingRows)).not.toContain(VALID_PNG_BASE64);
    await expect(page.getByRole("heading", { name: "使用记录", level: 1 })).toBeVisible();
    const editUsageRow = page.locator("tbody tr").filter({ hasText: "图像编辑" });
    await expect(editUsageRow).toHaveCount(1);
    await editUsageRow.getByRole("button", { name: "查看", exact: true }).click();
    const usageDetail = page.getByRole("dialog");
    await expect(usageDetail.getByText(editId, { exact: true })).toBeVisible();
    for (const field of ["input_text_tokens", "input_image_tokens", "output_image_tokens", "image_input_price_snapshot", "image_output_price_snapshot"]) {
      await expect(usageDetail.getByText(field, { exact: true })).toBeVisible();
    }
    await expect(usageDetail.getByRole("button", { name: "二次确认并查看完整报文" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("billing-image-detail-1440x1000.png") });
    await usageDetail.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: /展开筛选/ }).click();
    await page.getByRole("combobox", { name: "自动刷新", exact: true }).selectOption("15");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect(page).toHaveURL(/refreshSeconds=15/);
    await page.reload();
    await expect(page.locator("tbody tr").filter({ hasText: "图像编辑" })).toHaveCount(1);
    await page.getByRole("button", { name: /展开筛选/ }).click();
    await expect(page.getByRole("combobox", { name: "调用类型", exact: true })).toHaveValue("images.edits");
    await expect(page.getByRole("combobox", { name: "自动刷新", exact: true })).toHaveValue("15");
    await page.getByRole("combobox", { name: "调用类型", exact: true }).selectOption("text");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect(page.getByText("当前真实筛选范围没有请求。", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "调用类型", exact: true }).selectOption("images.generations");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: "图像生成" }).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("billing-image-filters-390x844.png") });
    await page.getByRole("button", { name: "关闭筛选", exact: true }).click();
    await page.locator("table").scrollIntoViewIfNeeded();
    await expect(page.locator("tbody tr").filter({ hasText: "图像生成" }).first()).toBeVisible();
    expect(await page.locator("table").locator("..").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("billing-image-usage-390x844.png") });
    await page.goto("/admin/image-models/models");
    await expect(page).toHaveURL(/\/admin\/image-models\/models$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "图像模型", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Image E2E Model Reviewed", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.getByRole("navigation", { name: "Image 模型中心子导航" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("image-model-center-390x844.png") });
    await page.goto("/admin/models/images?view=pricing");
    await expect(page).toHaveURL(/\/admin\/image-models\/pricing$/);
    await page.goto("/admin/models/models");
    await expect(page.getByRole("navigation", { name: "Models子导航" }).getByRole("link")).toHaveText(["Provider", "Models", "Pricing"]);

    // Fault fixture touches only this test's requests after all business/UI checks; no ledger or historical price changes.
    const sessionTimezone = String((await pool.query("SHOW TimeZone")).rows[0].TimeZone);
    testInfo.annotations.push({ type: "database-timezone", description: sessionTimezone });
    await pool.query("UPDATE gateway_requests SET created_at = $2::timestamptz WHERE id = $1", [generationId, "2026-09-30T23:59:59.999999Z"]);
    await pool.query("UPDATE gateway_requests SET created_at = $2::timestamptz WHERE id = $1", [editId, "2026-10-01T00:00:00.000000Z"]);
    await pool.query("UPDATE gateway_requests SET created_at = $2::timestamptz WHERE id = $1", [failedId, "2026-10-02T00:00:00.000000Z"]);
    const utcScope = new URLSearchParams({ from: "2026-10-01", to: "2026-10-01", providerId: String(provider.id), modelId: String(model.id) });
    const utcDashboard = await api.get(`/api/admin/usage-dashboard?${utcScope}`);
    expect(utcDashboard.status()).toBe(200);
    const utcData = (await utcDashboard.json()).data;
    expect(utcData.meta.timezone).toBe("UTC");
    expect(utcData.summary.requests).toBe("1");
    expect(utcData.summary.provider_cost_microusd).toBe("37");
    expect(utcData.trend).toHaveLength(1);
    expect(utcData.trend[0].bucket).toBe("2026-10-01T00:00:00.000Z");
    const utcListScope = new URLSearchParams({
      "filter[provider_id][eq]": String(provider.id), "filter[model_id][eq]": String(model.id),
      "filter[created_at][gte]": "2026-10-01T00:00:00.000Z", "filter[created_at][lte]": "2026-10-01T23:59:59.999999Z",
    });
    const utcList = await api.get(`/api/admin/usage?${utcListScope}`);
    expect(utcList.status()).toBe(200);
    expect((await utcList.json()).data.map((row: { id: string }) => row.id)).toEqual([editId]);
    const utcReport = await api.get("/api/admin/billing-report?from=2026-10-01&to=2026-10-01");
    expect(utcReport.status()).toBe(200);
    expect(await utcReport.json()).toMatchObject({
      meta: { timezone: "UTC", days: 1 },
      data: [{ day: "2026-10-01", requests: "1", provider_cost_microusd: "37", charged_microusd: "0" }],
    });
    // New API configuration is exercised after the original Image/report assertions so their accounting evidence stays independent.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/models/providers/new");
    await page.getByRole("button", { name: "OpenAI Official", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /^OpenAI 主对话 API(?: \*)?$/ })).toHaveValue("chat");
    await page.getByRole("combobox", { name: /^OpenAI 主对话 API(?: \*)?$/ }).selectOption("responses");
    await expect(page.getByRole("combobox", { name: "默认输出 Token 参数", exact: true })).toHaveCount(0);
    await page.getByLabel("Provider Code").fill(`responses-visible-${suffix}`);
    await page.getByLabel("显示名称").fill("Responses Visible E2E");
    await page.getByLabel("API Endpoint").fill(upstreamUrl);
    await page.getByLabel("API Key / 静态凭据").fill(`responses-fixture-secret-${suffix}`);
    await page.getByRole("combobox", { name: /^模型目录模式(?: \*)?$/ }).selectOption("manual");
    await page.getByLabel("手工上游型号").fill("responses-visible-upstream");
    const responsesCreate = page.waitForResponse((reply) => reply.url().endsWith("/api/admin/providers") && reply.request().method() === "POST");
    await page.getByRole("button", { name: "添加 Provider", exact: true }).click();
    const responsesCreateReply = await responsesCreate;
    expect(responsesCreateReply.status(), await responsesCreateReply.text()).toBe(201);
    const responsesProvider = (await responsesCreateReply.json()).data;
    await expect(page).toHaveURL(/\/admin\/models\/models\/new\?/);
    const responsesTextModel = await create(api, "/api/admin/models", headers, { providerId: responsesProvider.id, code: `responses-text-${suffix}`, upstreamModel: "responses-visible-upstream", displayName: "Responses text", contextWindow: 4096, maxOutputTokens: 128, capabilities: { chat: true }, requestHeaders: {}, enabled: true });
    await page.goto(`/admin/models/providers/${responsesProvider.id}/edit`);
    await expect(page.getByRole("combobox", { name: /^OpenAI 主对话 API(?: \*)?$/ })).toHaveValue("responses");
    await page.reload();
    await expect(page.getByRole("combobox", { name: /^OpenAI 主对话 API(?: \*)?$/ })).toHaveValue("responses");
    await page.getByRole("combobox", { name: /^运行状态(?: \*)?$/ }).selectOption("active");
    const responsesActivate = page.waitForResponse((reply) => reply.url().endsWith(`/api/admin/providers/${responsesProvider.id}`) && reply.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存 Provider", exact: true }).click();
    expect((await responsesActivate).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/models\/providers\?saved=/);
    const responsesValidation = providerCalls.filter((call) => call.path === "/v1/responses");
    expect(responsesValidation).toHaveLength(1);
    expect(JSON.parse(responsesValidation[0].body)).toMatchObject({ model: "responses-visible-upstream", store: false, stream: false, max_output_tokens: 1 });
    const afterActivation = (await pool.query("SELECT config, auth_revision FROM ai_providers WHERE id = $1", [responsesProvider.id])).rows[0];
    expect(afterActivation).toMatchObject({ config: { openaiApi: "responses", imageApi: { kind: "openai" } }, auth_revision: 2 });
    await create(api, "/api/admin/pricing-rules", headers, { modelId: responsesTextModel.id, userTier: "free", inputPriceMicrousdPerMillion: 1_000_000, outputPriceMicrousdPerMillion: 2_000_000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null });
    const textUserId = String(users.data.find((user: { external_user_id?: string }) => user.external_user_id === "102")?.id);
    expect(textUserId).not.toBe("undefined");
    const textPlan = await create(api, "/api/admin/subscription-plans", headers, { code: `responses-plan-${suffix}`, name: "Responses E2E Plan" });
    const textVersion = await create(api, "/api/admin/subscription-plan-versions", headers, { planId: textPlan.id, trialDays: 0, gracePeriodDays: 0, allowanceTokens: 100_000 });
    await create(api, "/api/admin/subscription-entitlements", headers, { planVersionId: textVersion.id, modelId: responsesTextModel.id, gatewayScopes: ["messages:create", "models:list"], dailyTokenLimit: 500_000, monthlyTokenLimit: 500_000, enabled: true });
    await create(api, `/api/admin/subscription-plan-versions/${textVersion.id}/publish`, headers, { idempotencyKey: `publish-responses-${suffix}`, reason: "Explicit Responses technical acceptance" }, 200);
    await create(api, "/api/admin/subscriptions", headers, { platformUserId: textUserId, planVersionId: textVersion.id, startsAt: new Date().toISOString(), startInTrial: false, idempotencyKey: `activate-responses-${suffix}`, reason: "Explicit Responses technical acceptance" });
    const textKey = await create(api, "/api/admin/gateway-api-keys", headers, { subjectMode: "fixed_user", platformUserId: textUserId, name: "Responses E2E key", scopes: ["messages:create", "models:list"], expiresAt: null });
    await page.goto(`/admin/models/models/${responsesTextModel.id}/edit`);
    await page.getByRole("checkbox", { name: "Tool Use", exact: true }).check();
    await page.getByRole("checkbox", { name: "Responses 图像生成", exact: true }).check();
    await page.getByRole("checkbox", { name: "Responses 图像编辑", exact: true }).check();
    await expect(page.getByRole("checkbox", { name: "Images 图像生成", exact: true })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Images 图像编辑", exact: true })).not.toBeChecked();
    await page.getByLabel("每张参考图输入 Token 预留", { exact: true }).fill("50");
    await page.getByLabel("每张结果图输出 Token 预留", { exact: true }).fill("100");
    const nativeCapabilityWrite = page.waitForResponse(reply => reply.url().endsWith(`/api/admin/models/${responsesTextModel.id}`) && reply.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存模型设置", exact: true }).click();
    const nativeCapabilityReply = await nativeCapabilityWrite;
    expect(nativeCapabilityReply.status(), await nativeCapabilityReply.text()).toBe(200);
    await page.goto(`/admin/models/models/${responsesTextModel.id}/edit`);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Responses 图像生成", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Responses 图像编辑", exact: true })).toBeChecked();
    const nativeCatalogReply = await fetch(`${baseURL}/v1/models`, { headers: { "x-api-key": String(textKey.plaintextKey) } });
    expect(nativeCatalogReply.status).toBe(200);
    const nativeCatalogModel = (await nativeCatalogReply.json()).data.find((entry: {id:string}) => entry.id === responsesTextModel.code);
    expect(nativeCatalogModel.endpoint_availability.responses_image).toEqual({generation:true,edit:true,configured:true,entitled:true,callable:true});
    expect(nativeCatalogModel.endpoint_availability.images).toMatchObject({generation:false,edit:false,callable:false});
    await testInfo.attach("native-capability-catalog.json", {body:JSON.stringify(nativeCatalogModel,null,2),contentType:"application/json"});
    await page.screenshot({path:testInfo.outputPath("native-capabilities-published.png"),fullPage:true});
    const textRequestIds: string[] = [];
    for (const stream of [false, true]) {
      const reply = await fetch(`${baseURL}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": String(textKey.plaintextKey), "idempotency-key": `responses-${stream}-${suffix}` }, body: JSON.stringify({ model: responsesTextModel.code, messages: [{ role: "user", content: "ordinary text" }], max_tokens: 32, stream }) });
      expect(reply.status, await reply.clone().text()).toBe(200);
      textRequestIds.push(reply.headers.get("x-request-id")!);
      const body = await reply.text();
      expect(body).toContain("Responses visible journey");
      expect(body).not.toContain("image_generation_call");
      if (stream) expect(body).toContain('"type":"message_stop"');
      else expect(JSON.parse(body)).toMatchObject({ content: [{ type: "text", text: "Responses visible journey" }] });
    }
    expect(providerCalls.filter((call) => call.path === "/v1/responses")).toHaveLength(3);
    expect((await pool.query("SELECT status, outcome, input_tokens, output_tokens FROM gateway_requests WHERE id = ANY($1::text[])", [textRequestIds])).rows).toEqual([expect.objectContaining({ status: "settled", outcome: "succeeded", input_tokens: "7", output_tokens: "2" }), expect.objectContaining({ status: "settled", outcome: "succeeded", input_tokens: "7", output_tokens: "2" })]);
    await testInfo.attach("responses-selected-wire.json", { body: JSON.stringify({ api: afterActivation.config.openaiApi, revision: afterActivation.auth_revision, requestIds: textRequestIds, paths: providerCalls.filter((call) => call.path === "/v1/responses").map((call) => call.path) }), contentType: "application/json" });
    await page.goto(`/admin/models/providers/${responsesProvider.id}/edit`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("combobox", { name: /^OpenAI 主对话 API(?: \*)?$/ })).toHaveValue("responses");
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("responses-provider-390x844.png") });
    expect(diagnostics).toEqual([]);
  } finally {
    await pool.end();
    await anonymous.dispose();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => error ? reject(error) : resolve());
      upstream.closeAllConnections();
    });
  }
});
