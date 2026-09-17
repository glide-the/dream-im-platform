// [Input] Explicit isolated PostgreSQL, real Admin session and public resource APIs.
// [Output] Enabled-only model selection and visible publication errors for disabled dependencies.
// [Pos] Provider-free entitlement browser contract; no real Provider calls or business data writes.
// [Sync] 2026-09-15: prove the Add Model Entitlement restriction in the production form.

import { expect, test } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const isolated = databaseUrl && process.env.INK_USE_TEST_DATABASE_URL === "1"
  && /(?:^|[_-])(?:test|codex)(?:[_-]|$)/.test(new URL(databaseUrl).pathname.slice(1));

test("only selects enabled models and rejects a model disabled after selection", async ({ context, page, baseURL }) => {
  test.skip(!isolated || !bootstrapToken, "Requires a named disposable PostgreSQL and explicit bootstrap token");
  test.setTimeout(180_000);
  const diagnostics: string[] = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`); });
  await context.route("**/unpkg.com/react-grab/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  const headers = { origin: new URL(baseURL!).origin, "content-type": "application/json" };
  const api = context.request;
  const bootstrap = await api.post("/api/admin/auth/bootstrap", {
    headers: { ...headers, "x-admin-bootstrap-token": bootstrapToken! },
    data: { email: "entitlement-models@example.test", password: "Entitlement-models-2026!", displayName: "Entitlement Model Admin" },
  });
  expect(bootstrap.status()).toBe(201);
  const provider = await api.post("/api/admin/providers", {
    headers, data: { code: "entitlement-models", name: "Entitlement Models", protocol: "anthropic", baseUrl: "https://api.anthropic.com", status: "disabled", timeoutMs: 5000, maxRetries: 0, config: {} },
  });
  expect(provider.status()).toBe(201);
  const providerId = (await provider.json()).data.id as string;
  const createModel = async (index: number, enabled: boolean) => {
    const code = `entitlement-model-${String(index).padStart(2, "0")}`;
    const response = await api.post("/api/admin/models", {
      headers, data: { providerId, code, upstreamModel: code, displayName: `${enabled ? "Enabled" : "Disabled"} Model ${index}`, capabilities: {}, enabled },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data.id as string;
  };
  const enabledIds: string[] = [];
  for (let index = 0; index < 51; index += 1) enabledIds.push(await createModel(index, true));
  const disabledId = await createModel(51, false);
  const plan = await api.post("/api/admin/subscription-plans", {
    headers, data: { code: "entitlement-models", name: "Entitlement Models" },
  });
  expect(plan.status()).toBe(201);
  const version = await api.post("/api/admin/subscription-plan-versions", {
    headers, data: { planId: (await plan.json()).data.id, allowanceTokens: 10000 },
  });
  expect(version.status()).toBe(201);
  const versionId = (await version.json()).data.id as string;
  const createEntitlement = (modelId: string) => api.post("/api/admin/subscription-entitlements", {
    headers, data: { planVersionId: versionId, modelId, gatewayScopes: ["messages:create", "models:list"], enabled: true },
  });
  const disabled = await createEntitlement(disabledId);
  expect(disabled.status()).toBe(409);
  expect((await disabled.json()).error.code).toBe("SUBSCRIPTION_ENTITLEMENT_MODEL_DISABLED");

  await page.goto("/admin/subscriptions/entitlements");
  await page.getByRole("button", { name: "添加模型权益", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型权益", exact: true });
  const model = dialog.getByRole("combobox", { name: "模型", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索模型选项", exact: true });
  const modelControl = model.locator("..");
  await expect(model.locator("option")).toHaveCount(51);
  await expect(model.getByRole("option", { name: /Disabled Model/ })).toHaveCount(0);
  await modelControl.getByRole("button", { name: "下一页" }).click();
  await expect(model.locator("option")).toHaveCount(2);
  await search.fill("Disabled Model");
  await expect(model.locator("option")).toHaveCount(1);
  await expect(modelControl.getByText("匹配 0 项 · 第 1 / 1 页")).toBeVisible();
  await search.fill("Enabled Model 0");
  await expect(model.getByRole("option", { name: /Enabled Model 0/ })).toHaveCount(1);
  await model.selectOption(enabledIds[0]);
  await dialog.getByRole("combobox", { name: "套餐版本", exact: true }).selectOption(versionId);
  await expect(dialog.getByRole("button", { name: "创建", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(model).toHaveValue(enabledIds[0]);
  expect((await api.patch(`/api/admin/models/${enabledIds[0]}`, { headers, data: { enabled: false } })).status()).toBe(200);
  const stale = await createEntitlement(enabledIds[0]);
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error.code).toBe("SUBSCRIPTION_ENTITLEMENT_MODEL_DISABLED");
  await search.fill("Enabled Model 1");
  await expect(model.getByRole("option", { name: /Enabled Model 1(?: ·|$)/ })).toHaveCount(1);
  await model.selectOption(enabledIds[1]);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("table").getByText("entitlement-model-01", { exact: true })).toBeVisible();

  await page.goto("/admin/subscriptions/versions");
  const row = page.getByRole("row").filter({ has: page.getByText("entitlement-models", { exact: true }) });
  await row.getByRole("button", { name: "发布", exact: true }).click();
  const publishDialog = page.getByRole("dialog", { name: "发布", exact: true });
  await publishDialog.getByRole("textbox", { name: /操作说明/ }).fill("Check model and Provider readiness");
  await publishDialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(publishDialog.getByRole("alert")).toContainText("提供商未启用：entitlement-models");
  await publishDialog.getByRole("button", { name: "取消", exact: true }).click();
  expect((await api.patch(`/api/admin/models/${enabledIds[1]}`, { headers, data: { enabled: false } })).status()).toBe(200);
  await row.getByRole("button", { name: "发布", exact: true }).click();
  await publishDialog.getByRole("textbox", { name: /操作说明/ }).fill("Check disabled model readiness");
  await publishDialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(publishDialog.getByRole("alert")).toContainText("模型未启用：entitlement-model-01");
  await expect(publishDialog.getByRole("alert")).toContainText("提供商未启用：entitlement-models");
  await publishDialog.getByRole("button", { name: "取消", exact: true }).click();
  const retainedVersion = await api.get(`/api/admin/subscription-plan-versions/${versionId}`);
  expect((await retainedVersion.json()).data.status).toBe("draft");
  expect(diagnostics).toEqual([]);
});
