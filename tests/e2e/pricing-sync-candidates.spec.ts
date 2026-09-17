// [Input] Explicit disposable PostgreSQL, real Admin session and production catalog/selection DTOs.
// [Output] Browser and API evidence for candidate comparison, manual apply, provenance and rejected overrides.
// [Pos] Provider-free pricing candidate E2E; snapshot SQL is fixture setup, all operations use public Admin routes.
// [Sync] 2026-09-14: cover legacy snapshots, all 25 candidates, both viewports and immutable price application.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { flattenModelsDevCatalog, matchModelsDevPricing } from "../../app/lib/admin/pricing-sync";

const databaseUrl = process.env.TEST_DATABASE_URL;
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const snapshotId = "pricing-candidates-e2e";

function ownedDatabase() {
  if (!databaseUrl || process.env.INK_USE_TEST_DATABASE_URL !== "1") return false;
  const url = new URL(databaseUrl);
  return ["postgres:", "postgresql:"].includes(url.protocol) && /^ink_.*_test$/.test(url.pathname.slice(1));
}

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") diagnostics.push(`requestfailed: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

test("compares collapsed candidates and applies the selected snapshot price", async ({ context, page, request, baseURL }, testInfo) => {
  test.skip(!bootstrapToken || !ownedDatabase(), "Requires an explicitly named disposable TEST_DATABASE_URL and bootstrap token");
  test.setTimeout(180_000);
  const diagnostics = collectDiagnostics(page);
  await context.route("http://unpkg.com/react-grab/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  const headers = { origin: new URL(baseURL!).origin, "content-type": "application/json" };
  const api = context.request;
  const bootstrap = await api.post("/api/admin/auth/bootstrap", {
    headers: { ...headers, "x-admin-bootstrap-token": bootstrapToken! },
    data: { email: "pricing-candidates@example.test", password: "Pricing-candidates-2026!", displayName: "Pricing Candidate Admin" },
  });
  expect(bootstrap.status()).toBe(201);
  const provider = await api.post("/api/admin/providers", {
    headers, data: { code: "pricing-candidates", name: "Custom Pricing", protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "unused-provider-fixture-secret", status: "disabled", timeoutMs: 5_000, maxRetries: 0, config: { authMode: "x-api-key", modelCatalogMode: "auto" } },
  });
  expect(provider.status()).toBe(201);
  const providerId = (await provider.json()).data.id as string;
  const model = await api.post("/api/admin/models", {
    headers, data: { providerId, code: "pricing-candidate-model", upstreamModel: "model-a", displayName: "Pricing Candidate Model", contextWindow: 8_192, maxOutputTokens: 512, capabilities: { chat: true }, enabled: false },
  });
  expect(model.status()).toBe(201);
  const modelId = (await model.json()).data.id as string;
  const catalog = flattenModelsDevCatalog(Object.fromEntries(Array.from({ length: 25 }, (_, index) => [
    `source-${index + 1}`, { name: `Source ${index + 1}`, models: { "model-a": { name: "Model A", cost: { input: index + 1, output: (index + 1) * 2, cache_read: (index + 1) / 10, cache_write: (index + 1) * 1.25 } } } },
  ])));
  const matches = matchModelsDevPricing([{ id: modelId, code: "pricing-candidate-model", upstream_model: "model-a", provider_code: "pricing-candidates", provider_name: "Custom Pricing" }], catalog);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    expect((await client.query("SELECT current_database() AS name")).rows[0].name).toBe(new URL(databaseUrl!).pathname.slice(1));
    for (const [id, data] of [
      [snapshotId, matches],
      [`${snapshotId}-legacy`, matches.map(({ candidateDetails, ...match }) => match)],
    ] as const) {
      await client.query(`INSERT INTO ai_pricing_sync_snapshots (id, provider_id, catalog_ref, catalog_version, catalog_hash, matches, created_by, expires_at)
        VALUES ($1, $2, 'https://models.dev/api.json', 'candidate-fixture-v1', 'candidate-fixture-hash', $3::jsonb, 'e2e', now() + interval '10 minutes')`, [id, providerId, JSON.stringify(data)]);
    }
    const applyPath = `/api/admin/pricing-sync/${snapshotId}/apply`;
    expect((await request.post(applyPath, { headers, data: { modelIds: [modelId] } })).status()).toBe(401);
    for (const candidateSelections of [[], [{ localModelId: modelId, key: "outside/model-a" }], [{ localModelId: "other-model", key: "source-2/model-a" }]]) {
      const response = await api.post(applyPath, { headers, data: { modelIds: [modelId], candidateSelections } });
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe("PRICING_SYNC_SELECTION_INVALID");
    }
    const tampered = await api.post(applyPath, { headers, data: { modelIds: [modelId], candidateSelections: [{ localModelId: modelId, key: "source-2/model-a", inputMicrousd: "0" }] } });
    expect(tampered.status()).toBe(400);
    expect((await client.query("SELECT count(*)::integer AS count FROM ai_pricing_rules WHERE model_id = $1", [modelId])).rows[0].count).toBe(0);

    await page.goto(`/admin/models/pricing/sync/${snapshotId}-legacy`);
    await page.getByRole("button", { name: "展开 pricing-candidate-model 的 25 个候选" }).click();
    await expect(page.getByText("此快照未保存候选价格，重新同步后即可比较和选择。")).toBeVisible();
    await expect(page.getByRole("button", { name: "重新同步以加载候选价格" })).toBeEnabled();
    await expect(page.getByRole("radio")).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/models/pricing/sync/${snapshotId}`);
    const checkbox = page.getByRole("checkbox", { name: "选择 pricing-candidate-model", exact: true });
    const row = page.getByRole("row").filter({ has: checkbox });
    await expect(checkbox).toBeDisabled();
    await expect(row.getByText("请选择价格来源", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await page.getByRole("button", { name: "展开 pricing-candidate-model 的 25 个候选" }).click();
    await expect(page.getByRole("radio")).toHaveCount(25);
    await page.getByRole("radio", { name: "为 pricing-candidate-model 选择 source-2/model-a", exact: true }).check();
    await expect(checkbox).toBeChecked();
    await expect(row.getByText("source-2/model-a", { exact: true })).toBeVisible();
    await expect(row.getByRole("cell").nth(3)).toHaveText(/^\$2\s*\/ 1M$/);
    await page.screenshot({ path: testInfo.outputPath("pricing-candidates-expanded-desktop-1440x1000.png") });
    await page.getByRole("button", { name: "收起 pricing-candidate-model 的 25 个候选" }).click();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await checkbox.uncheck();
    await expect(page.getByRole("button", { name: "应用 0 个价格版本" })).toBeDisabled();
    await checkbox.check();
    await page.getByRole("button", { name: "展开筛选", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索价格匹配" }).fill("no-matching-model");
    await expect(row).toHaveCount(0);
    await page.getByRole("textbox", { name: "搜索价格匹配" }).fill("");
    await expect(row.getByText("source-2/model-a", { exact: true })).toBeVisible();
    await expect(checkbox).toBeChecked();
    await page.getByRole("button", { name: "收起筛选", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("pricing-candidates-desktop-1440x1000.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "展开 pricing-candidate-model 的 25 个候选" }).click();
    await page.getByRole("radio", { name: "为 pricing-candidate-model 选择 source-25/model-a", exact: true }).check();
    await expect(row.getByText("source-25/model-a", { exact: true })).toBeVisible();
    await expect(row.getByRole("cell").nth(3)).toHaveText(/^\$25\s*\/ 1M$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("pricing-candidates-mobile-390x844.png") });
    await page.getByRole("button", { name: "收起 pricing-candidate-model 的 25 个候选" }).click();
    const applyResponse = page.waitForResponse((response) => response.url().endsWith(applyPath));
    await page.getByRole("button", { name: "应用 1 个价格版本" }).click();
    expect((await applyResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/models\/pricing\?synced=/);
    const pricing = (await client.query("SELECT * FROM ai_pricing_rules WHERE model_id = $1", [modelId])).rows;
    expect(pricing).toHaveLength(1);
    expect(pricing[0]).toMatchObject({ source_ref: "source-25/model-a", source_version: "candidate-fixture-v1", input_price_microusd_per_million: "25000000", output_price_microusd_per_million: "50000000", cache_read_price_microusd_per_million: "2500000", cache_write_price_microusd_per_million: "31250000", source_metadata: expect.objectContaining({ manualSelection: true, match: "ambiguous" }) });
    const snapshot = (await client.query("SELECT status, matches FROM ai_pricing_sync_snapshots WHERE id = $1", [snapshotId])).rows[0];
    expect(snapshot.status).toBe("applied");
    expect(snapshot.matches).toEqual(matches);
    const audit = (await client.query("SELECT metadata FROM admin_audit_logs WHERE action = 'models_dev_pricing_apply' AND resource_id = $1", [snapshotId])).rows[0];
    expect(audit.metadata.candidateSelections).toEqual([{ localModelId: modelId, key: "source-25/model-a" }]);
    // Equal prices must still preserve an operator's explicitly changed source as a new version.
    const newMatches = matches.map((match) => ({ ...match, candidateDetails: match.candidateDetails!.map((candidate) => candidate.key === "source-24/model-a" ? {
      ...candidate, inputMicrousd: pricing[0].input_price_microusd_per_million, outputMicrousd: pricing[0].output_price_microusd_per_million,
      cacheReadMicrousd: pricing[0].cache_read_price_microusd_per_million, cacheWriteMicrousd: pricing[0].cache_write_price_microusd_per_million,
    } : candidate) }));
    await client.query(`INSERT INTO ai_pricing_sync_snapshots (id, provider_id, catalog_ref, catalog_version, catalog_hash, matches, created_by, expires_at)
      VALUES ($1, $2, 'https://models.dev/api.json', 'candidate-fixture-v2', 'candidate-fixture-hash-v2', $3::jsonb, 'e2e', now() + interval '10 minutes')`, [`${snapshotId}-equal-price`, providerId, JSON.stringify(newMatches)]);
    const newEffectiveFrom = new Date(new Date(pricing[0].effective_from).getTime() + 1_000).toISOString();
    const changedSource = await api.post(`/api/admin/pricing-sync/${snapshotId}-equal-price/apply`, {
      headers, data: { modelIds: [modelId], candidateSelections: [{ localModelId: modelId, key: "source-24/model-a" }], effectiveFrom: newEffectiveFrom },
    });
    expect(changedSource.status()).toBe(200);
    expect((await changedSource.json()).data.created).toHaveLength(1);
    const versions = (await client.query("SELECT source_ref, effective_to, input_price_microusd_per_million FROM ai_pricing_rules WHERE model_id = $1 ORDER BY effective_from", [modelId])).rows;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ source_ref: "source-25/model-a", input_price_microusd_per_million: "25000000" });
    expect(versions[0].effective_to).not.toBeNull();
    expect(versions[1]).toMatchObject({ source_ref: "source-24/model-a", effective_to: null, input_price_microusd_per_million: "25000000" });
    expect(diagnostics).toEqual([]);
  } finally {
    await client.end();
  }
});
