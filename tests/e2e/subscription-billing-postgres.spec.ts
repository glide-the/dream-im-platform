import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
let upstream: Server | undefined;
let upstreamUrl = "";
let upstreamRequestCount = 0;

function diagnosticsFor(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      text.includes("unpkg.com/react-grab/") ||
      text === "Failed to load resource: net::ERR_FAILED" ||
      text === "Event"
    ) return;
    diagnostics.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().includes("unpkg.com/react-grab/")) return;
    diagnostics.push(`${request.failure()?.errorText}: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

test.describe("subscription billing on owned PostgreSQL", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!bootstrapToken, "Requires an explicit owned PostgreSQL bootstrap token");

  test.beforeAll(async () => {
    if (process.env.E2E_PROVIDER_URL) {
      upstreamUrl = process.env.E2E_PROVIDER_URL;
      return;
    }
    upstream = createServer((request, response) => {
      upstreamRequestCount += 1;
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "msg_subscription_e2e",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "subscription-upstream",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
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
    await new Promise<void>((resolve, reject) => upstream!.close((error) => error ? reject(error) : resolve()));
  });

  test("covers immutable versions, lifecycle, allowance settlement and responsive UI", async ({ context, page, request, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    expect((await request.get(`${baseURL}/api/admin/subscription-plans`)).status()).toBe(401);

    await page.goto("/admin");
    await page.getByLabel("显示名称").fill("Subscription Owner");
    await page.getByLabel("管理员邮箱").fill("subscription-owner@example.test");
    await page.getByLabel("初始密码").fill("Subscription-owner-2026!");
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const diagnostics = diagnosticsFor(page);

    const api = context.request;
    const headers = { origin, "content-type": "application/json" };
    const platformUsers = await api.get(`${baseURL}/api/admin/platform-users?sort=email&order=asc`);
    expect(platformUsers.status()).toBe(200);
    const platformUsersBody = await platformUsers.json();
    expect(platformUsersBody.meta.total).toBe(2);
    expect(platformUsersBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ external_user_id: "101", email: "creator@example.test" }),
      expect.objectContaining({ external_user_id: "102", email: "other@example.test" }),
    ]));
    const billingUserId = String(platformUsersBody.data.find((user: { external_user_id: string }) => user.external_user_id === "101")?.id);
    const cashBackedBillingUserId = String(platformUsersBody.data.find((user: { external_user_id: string }) => user.external_user_id === "102")?.id);
    expect(billingUserId).not.toBe("undefined");
    expect(cashBackedBillingUserId).not.toBe("undefined");
    const provider = await api.post(`${baseURL}/api/admin/providers`, {
      headers,
      data: { code: "subscription-provider", name: "Subscription Provider", protocol: "anthropic", baseUrl: upstreamUrl, apiKey: "subscription-provider-test-secret", status: "active", timeoutMs: 5000, maxRetries: 0, config: { authMode: "x-api-key" } },
    });
    expect(provider.status()).toBe(201);
    const providerId = (await provider.json()).data.id;
    const model = await api.post(`${baseURL}/api/admin/models`, {
      headers,
      data: { providerId, code: "subscription-model", upstreamModel: "subscription-upstream", displayName: "Subscription Model", contextWindow: 100000, maxOutputTokens: 1024, capabilities: { chat: true, streaming: true }, enabled: true },
    });
    expect(model.status()).toBe(201);
    const modelId = (await model.json()).data.id;
    const immutableEntitlementModel = await api.post(`${baseURL}/api/admin/models`, {
      headers,
      data: { providerId, code: "subscription-immutable-model", upstreamModel: "subscription-immutable-upstream", displayName: "Subscription Immutable Entitlement Model", contextWindow: 100000, maxOutputTokens: 1024, capabilities: { chat: true, streaming: true }, enabled: true },
    });
    expect(immutableEntitlementModel.status()).toBe(201);
    const immutableEntitlementModelId = (await immutableEntitlementModel.json()).data.id as string;
    expect((await api.post(`${baseURL}/api/admin/pricing-rules`, {
      headers,
      data: { modelId, userTier: "free", inputPriceMicrousdPerMillion: 1000000, outputPriceMicrousdPerMillion: 2000000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: null },
    })).status()).toBe(201);

    const legacyPlan = await api.post(`${baseURL}/api/admin/subscription-plans`, {
      headers,
      data: { code: "legacy-money-plan", name: "Legacy Money Plan", currency: "USD" },
    });
    expect(legacyPlan.status()).toBe(400);

    const plan = await api.post(`${baseURL}/api/admin/subscription-plans`, {
      headers,
      data: { code: "dream-pro", name: "Dream Pro", description: "E2E Token plan" },
    });
    expect(plan.status()).toBe(201);
    const planId = (await plan.json()).data.id;
    const legacyVersion = await api.post(`${baseURL}/api/admin/subscription-plan-versions`, {
      headers,
      data: {
        planId,
        billingPeriod: "monthly",
        basePriceMicrousd: 1_000_000,
        allowanceTokens: 100000,
        allowanceMicrousd: 5_000_000,
        overagePolicy: "cash_balance",
        effectiveFrom: new Date().toISOString(),
      },
    });
    expect(legacyVersion.status()).toBe(400);

    const createVersion = async (allowanceTokens = 100000, versionPlanId = planId) => {
      const response = await api.post(`${baseURL}/api/admin/subscription-plan-versions`, {
        headers,
        data: { planId: versionPlanId, trialDays: 7, gracePeriodDays: 3, allowanceTokens },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).data.id as string;
    };
    const publishVersion = async (id: string, suffix: string) => {
      const entitlement = await api.post(`${baseURL}/api/admin/subscription-entitlements`, {
        headers,
        data: { planVersionId: id, modelId, gatewayScopes: ["messages:create", "models:list"], requestsPerMinute: 30, dailyTokenLimit: 50000, monthlyTokenLimit: 500000, storageBytesLimit: 1000000, enabled: true },
      });
      expect(entitlement.status()).toBe(201);
      const entitlementId = (await entitlement.json()).data.id as string;
      const legacyPublish = await api.post(`${baseURL}/api/admin/subscription-plan-versions/${id}/publish`, {
        headers,
        data: { effectiveFrom: new Date().toISOString(), idempotencyKey: `legacy-publish:${suffix}:e2e`, reason: "Reject global effective date" },
      });
      expect(legacyPublish.status()).toBe(400);
      const response = await api.post(`${baseURL}/api/admin/subscription-plan-versions/${id}/publish`, {
        headers,
        data: { idempotencyKey: `publish:${suffix}:e2e`, reason: "E2E publish" },
      });
      expect(response.status()).toBe(200);
      return entitlementId;
    };
    const versionOne = await createVersion();
    const versionOneEntitlementId = await publishVersion(versionOne, "v1");
    const immutable = await api.patch(`${baseURL}/api/admin/subscription-plan-versions/${versionOne}`, {
      headers,
      data: { allowanceTokens: 100001 },
    });
    expect(immutable.status()).toBe(409);
    await expect(immutable.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_VERSION_IMMUTABLE" } });

    const immutableEntitlementCreate = await api.post(`${baseURL}/api/admin/subscription-entitlements`, {
      headers,
      data: { planVersionId: versionOne, modelId: immutableEntitlementModelId, gatewayScopes: ["messages:create"], enabled: true },
    });
    expect(immutableEntitlementCreate.status()).toBe(409);
    await expect(immutableEntitlementCreate.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_ENTITLEMENT_IMMUTABLE" } });
    const immutableEntitlementUpdate = await api.patch(`${baseURL}/api/admin/subscription-entitlements/${versionOneEntitlementId}`, {
      headers,
      data: { enabled: false },
    });
    expect(immutableEntitlementUpdate.status()).toBe(409);
    await expect(immutableEntitlementUpdate.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_ENTITLEMENT_IMMUTABLE" } });

    const startsAt = new Date();
    startsAt.setUTCDate(1);
    startsAt.setUTCMonth(startsAt.getUTCMonth() - 4);
    startsAt.setUTCMinutes(startsAt.getUTCMinutes() - 1);
    const activationKey = "activate:user-e2e:dream-pro:e2e";
    const activate = await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: billingUserId, planVersionId: versionOne, startsAt: startsAt.toISOString(), startInTrial: false, idempotencyKey: activationKey, reason: "E2E activation" },
    });
    expect(activate.status()).toBe(201);
    const activatedSubscription = (await activate.json()).data as Record<string, unknown>;
    const subscriptionId = String(activatedSubscription.id);
    let expectedVersion = Number(activatedSubscription.version);
    const duplicate = await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: billingUserId, planVersionId: versionOne, startsAt: startsAt.toISOString(), startInTrial: false, idempotencyKey: activationKey, reason: "E2E activation" },
    });
    expect(duplicate.status()).toBe(201);
    expect((await duplicate.json()).data.id).toBe(subscriptionId);
    const activationPayloadConflict = await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: billingUserId, planVersionId: versionOne, startsAt: startsAt.toISOString(), startInTrial: false, idempotencyKey: activationKey, reason: "E2E activation with changed payload" },
    });
    expect(activationPayloadConflict.status()).toBe(409);
    await expect(activationPayloadConflict.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_IDEMPOTENCY_CONFLICT" } });
    expect((await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: billingUserId, planVersionId: versionOne, startsAt: startsAt.toISOString(), startInTrial: false, idempotencyKey: "activate:user-e2e:conflict:e2e", reason: "E2E conflict" },
    })).status()).toBe(409);

    const command = async (action: string, key: string, data: Record<string, unknown> = {}) => api.post(`${baseURL}/api/admin/subscriptions/${subscriptionId}/${action}`, { headers, data: { idempotencyKey: key, reason: `E2E ${action}`, expectedVersion, ...data } });
    const versionTwo = await createVersion(120000);
    await publishVersion(versionTwo, "v2");
    const versionThree = await createVersion(150000);
    await publishVersion(versionThree, "v3");
    const downgrade = await command("downgrade", "downgrade:subscription:e2e", { planVersionId: versionTwo });
    expect(downgrade.status()).toBe(200);
    const downgradedSubscription = (await downgrade.json()).data as Record<string, unknown>;
    expect(downgradedSubscription).toMatchObject({
      plan_version_id: versionOne,
      pending_plan_version_id: versionTwo,
    });
    expectedVersion = Number(downgradedSubscription.version);
    const actionIdempotencyConflict = await api.post(`${baseURL}/api/admin/subscriptions/${subscriptionId}/upgrade`, {
      headers,
      data: { idempotencyKey: "downgrade:subscription:e2e", reason: "E2E downgrade", expectedVersion, planVersionId: versionTwo },
    });
    expect(actionIdempotencyConflict.status()).toBe(409);
    await expect(actionIdempotencyConflict.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_IDEMPOTENCY_CONFLICT" } });
    const upgrade = await command("upgrade", "upgrade:subscription:e2e", { planVersionId: versionThree });
    expect(upgrade.status()).toBe(200);
    const upgradedSubscription = (await upgrade.json()).data as Record<string, unknown>;
    expect(upgradedSubscription).toMatchObject({
      plan_version_id: versionOne,
      pending_plan_version_id: versionThree,
    });
    expectedVersion = Number(upgradedSubscription.version);
    const targetIdempotencyConflict = await command("upgrade", "upgrade:subscription:e2e", { planVersionId: versionTwo });
    expect(targetIdempotencyConflict.status()).toBe(409);
    await expect(targetIdempotencyConflict.json()).resolves.toMatchObject({ error: { code: "SUBSCRIPTION_IDEMPOTENCY_CONFLICT" } });

    const allowancesBeforeDelayedRenew = await api.get(`${baseURL}/api/admin/subscription-allowances?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(allowancesBeforeDelayedRenew.status()).toBe(200);
    const allowancesBeforeDelayedRenewBody = await allowancesBeforeDelayedRenew.json();
    expect(allowancesBeforeDelayedRenewBody.data).toEqual([
      expect.objectContaining({ subscription_id: subscriptionId, period_number: 0, plan_version_id: versionOne }),
    ]);
    const renewRequestedAt = Date.now();
    const renew = await command("renew", "renew:subscription:e2e");
    expect(renew.status()).toBe(200);
    const renewedSubscription = (await renew.json()).data as Record<string, unknown>;
    expectedVersion = Number(renewedSubscription.version);
    expect(renewedSubscription).toMatchObject({
      plan_version_id: versionThree,
      pending_plan_version_id: null,
      granted_tokens: "150000",
    });
    const renewedPeriodNumber = Number(renewedSubscription.current_period_number);
    expect(renewedPeriodNumber).toBeGreaterThan(1);
    expect(Date.parse(String(renewedSubscription.current_period_start))).toBeLessThanOrEqual(renewRequestedAt);
    expect(Date.parse(String(renewedSubscription.current_period_end))).toBeGreaterThan(renewRequestedAt);

    const allowancesAfterDelayedRenew = await api.get(`${baseURL}/api/admin/subscription-allowances?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(allowancesAfterDelayedRenew.status()).toBe(200);
    const allowancesAfterDelayedRenewBody = await allowancesAfterDelayedRenew.json();
    expect(allowancesAfterDelayedRenewBody.data).toHaveLength(2);
    expect(
      allowancesAfterDelayedRenewBody.data
        .map((allowance: { period_number: number }) => allowance.period_number)
        .sort((left: number, right: number) => left - right),
    ).toEqual([0, renewedPeriodNumber]);
    expect(allowancesAfterDelayedRenewBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subscription_id: subscriptionId,
        plan_version_id: versionThree,
        period_number: renewedPeriodNumber,
        period_start: renewedSubscription.current_period_start,
        period_end: renewedSubscription.current_period_end,
        granted_tokens: "150000",
      }),
    ]));

    const gatewayKey = await api.post(`${baseURL}/api/admin/gateway-api-keys`, {
      headers,
      data: { subjectMode: "fixed_user", platformUserId: billingUserId, name: "subscription-e2e", scopes: ["messages:create", "models:list"], expiresAt: null },
    });
    expect(gatewayKey.status()).toBe(201);
    const plaintextKey = (await gatewayKey.json()).data.plaintextKey as string;
    const gateway = await api.post(`${baseURL}/v1/messages`, {
      headers: { "content-type": "application/json", "x-api-key": plaintextKey, "idempotency-key": "subscription-gateway-success-e2e" },
      data: { model: "subscription-model", max_tokens: 32, messages: [{ role: "user", content: "hello" }] },
    });
    expect(gateway.status()).toBe(200);
    const successfulGatewayRequestId = gateway.headers()["x-request-id"];
    expect(successfulGatewayRequestId).toBeTruthy();
    const usage = await api.get(`${baseURL}/api/admin/usage?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(usage.status()).toBe(200);
    await expect(usage.json()).resolves.toMatchObject({ data: [expect.objectContaining({ subscription_id: subscriptionId, subscription_coverage_mode: "token_allowance", allowance_charged_tokens: "15", allowance_charged_microusd: "0", reserved_microusd: "0", charged_microusd: "0" })] });

    const tokenLedger = await api.get(
      `${baseURL}/api/admin/token-ledger?sort=request_sequence&order=asc&filter[gateway_request_id][eq]=${encodeURIComponent(successfulGatewayRequestId)}`,
    );
    expect(tokenLedger.status()).toBe(200);
    const tokenLedgerBody = await tokenLedger.json();
    expect(tokenLedgerBody.meta.total).toBe(3);
    expect(tokenLedgerBody.data.map((entry: Record<string, unknown>) => ({
      sequence: Number(entry.request_sequence),
      type: entry.entry_type,
      amount: Number(entry.amount_tokens),
      unit: entry.unit,
    }))).toEqual([
      { sequence: 1, type: "reserve", amount: expect.any(Number), unit: "tokens" },
      { sequence: 2, type: "capture", amount: 15, unit: "tokens" },
      { sequence: 3, type: "release", amount: expect.any(Number), unit: "tokens" },
    ]);
    expect(Number(tokenLedgerBody.data[0].amount_tokens)).toBe(
      Number(tokenLedgerBody.data[1].amount_tokens) +
        Number(tokenLedgerBody.data[2].amount_tokens),
    );
    expect(JSON.stringify(tokenLedgerBody)).not.toMatch(/microusd|payment|secret/i);

    const allowances = await api.get(`${baseURL}/api/admin/subscription-allowances?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(allowances.status()).toBe(200);
    const allowanceRows = (await allowances.json()).data as Array<Record<string, unknown>>;
    expect(allowanceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ subscription_id: subscriptionId, period_number: renewedPeriodNumber, granted_tokens: "150000" }),
    ]));
    for (const allowance of allowanceRows) {
      expect(allowance).not.toHaveProperty("granted_microusd");
      expect(allowance).not.toHaveProperty("reserved_microusd");
      expect(allowance).not.toHaveProperty("consumed_microusd");
    }

    const subscriptionLedger = await api.get(`${baseURL}/api/admin/ledger?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(subscriptionLedger.status()).toBe(200);
    const subscriptionLedgerBody = await subscriptionLedger.json();
    for (const entryType of ["subscription_charge", "allowance_capture"]) {
      expect(subscriptionLedgerBody.data).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ entry_type: entryType }),
      ]));
    }

    const oneTokenPlan = await api.post(`${baseURL}/api/admin/subscription-plans`, {
      headers,
      data: { code: "one-token-only", name: "One Token Only", description: "E2E exhausted Token allowance" },
    });
    expect(oneTokenPlan.status()).toBe(201);
    const oneTokenPlanId = (await oneTokenPlan.json()).data.id as string;
    const oneTokenVersionId = await createVersion(1, oneTokenPlanId);
    await publishVersion(oneTokenVersionId, "one-token");
    const cashCredit = await api.post(`${baseURL}/api/admin/platform-users/${encodeURIComponent(cashBackedBillingUserId)}/account/credit`, {
      headers,
      data: { amountMicrousd: 1_000_000, reason: "E2E positive cash balance must not cover exhausted Tokens", idempotencyKey: "credit:token-exhausted:e2e" },
    });
    expect(cashCredit.status()).toBe(200);
    await expect(cashCredit.json()).resolves.toMatchObject({
      data: { account: { availableMicrousd: expect.any(Number), reservedMicrousd: 0 } },
    });
    const oneTokenActivation = await api.post(`${baseURL}/api/admin/subscriptions`, {
      headers,
      data: { platformUserId: cashBackedBillingUserId, planVersionId: oneTokenVersionId, startInTrial: false, idempotencyKey: "activate:one-token:e2e", reason: "E2E one Token activation" },
    });
    expect(oneTokenActivation.status()).toBe(201);
    const oneTokenSubscription = (await oneTokenActivation.json()).data as Record<string, unknown>;
    const oneTokenSubscriptionId = String(oneTokenSubscription.id);
    const exhaustedGatewayKey = await api.post(`${baseURL}/api/admin/gateway-api-keys`, {
      headers,
      data: { subjectMode: "fixed_user", platformUserId: cashBackedBillingUserId, name: "subscription-token-exhausted-e2e", scopes: ["messages:create"], expiresAt: null },
    });
    expect(exhaustedGatewayKey.status()).toBe(201);
    const exhaustedPlaintextKey = (await exhaustedGatewayKey.json()).data.plaintextKey as string;

    const cashAccountUrl = `${baseURL}/api/admin/billing-accounts?pageSize=100&filter[platform_user_id][eq]=${encodeURIComponent(cashBackedBillingUserId)}`;
    const cashAccountBeforeResponse = await api.get(cashAccountUrl);
    expect(cashAccountBeforeResponse.status()).toBe(200);
    const cashAccountBefore = (await cashAccountBeforeResponse.json()).data[0] as Record<string, unknown>;
    expect(Number(cashAccountBefore.available_microusd)).toBeGreaterThan(0);
    expect(cashAccountBefore.reserved_microusd).toBe("0");
    const cashLedgerUrl = `${baseURL}/api/admin/ledger?pageSize=100&sort=created_at&order=asc&filter[platform_user_id][eq]=${encodeURIComponent(cashBackedBillingUserId)}`;
    const cashLedgerBeforeResponse = await api.get(cashLedgerUrl);
    expect(cashLedgerBeforeResponse.status()).toBe(200);
    const cashLedgerBefore = await cashLedgerBeforeResponse.json();
    const oneTokenAllowancesUrl = `${baseURL}/api/admin/subscription-allowances?filter[subscription_id][eq]=${encodeURIComponent(oneTokenSubscriptionId)}`;
    const oneTokenAllowancesBeforeResponse = await api.get(oneTokenAllowancesUrl);
    expect(oneTokenAllowancesBeforeResponse.status()).toBe(200);
    const oneTokenAllowancesBefore = await oneTokenAllowancesBeforeResponse.json();
    expect(oneTokenAllowancesBefore.data).toEqual([
      expect.objectContaining({ granted_tokens: "1", reserved_tokens: "0", consumed_tokens: "0" }),
    ]);

    const upstreamCallsBeforeExhaustion = upstreamRequestCount;
    const exhaustedGatewayCall = await api.post(`${baseURL}/v1/messages`, {
      headers: { "content-type": "application/json", "x-api-key": exhaustedPlaintextKey, "idempotency-key": "subscription-token-exhausted-gateway-e2e" },
      data: { model: "subscription-model", max_tokens: 32, messages: [{ role: "user", content: "Token estimate must exceed the one Token allowance" }] },
    });
    expect(exhaustedGatewayCall.status()).toBe(402);
    const exhaustedRequestId = exhaustedGatewayCall.headers()["x-request-id"];
    expect(exhaustedRequestId).toBeTruthy();
    expect(await exhaustedGatewayCall.json()).toEqual({
      type: "error",
      request_id: exhaustedRequestId,
      error: {
        type: "billing_error",
        code: "SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED",
        message: "The current subscription-period Token allowance is insufficient",
        request_id: exhaustedRequestId,
        metric: "tokens",
        unit: "tokens",
        available_tokens: 1,
        required_tokens: expect.any(Number),
        period_end: oneTokenSubscription.current_period_end,
      },
    });
    if (upstream) expect(upstreamRequestCount).toBe(upstreamCallsBeforeExhaustion);

    const cashAccountAfterResponse = await api.get(cashAccountUrl);
    expect(cashAccountAfterResponse.status()).toBe(200);
    const cashAccountAfter = (await cashAccountAfterResponse.json()).data[0] as Record<string, unknown>;
    expect(cashAccountAfter).toMatchObject({
      available_microusd: cashAccountBefore.available_microusd,
      reserved_microusd: cashAccountBefore.reserved_microusd,
      version: cashAccountBefore.version,
    });
    const cashLedgerAfterResponse = await api.get(cashLedgerUrl);
    expect(cashLedgerAfterResponse.status()).toBe(200);
    const cashLedgerAfter = await cashLedgerAfterResponse.json();
    expect(cashLedgerAfter).toEqual(cashLedgerBefore);
    for (const entryType of ["allowance_capture", "subscription_charge"]) {
      expect(cashLedgerAfter.data).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ entry_type: entryType }),
      ]));
    }
    const oneTokenAllowancesAfterResponse = await api.get(oneTokenAllowancesUrl);
    expect(oneTokenAllowancesAfterResponse.status()).toBe(200);
    expect(await oneTokenAllowancesAfterResponse.json()).toEqual(oneTokenAllowancesBefore);

    const pause = await command("pause", "pause:subscription:e2e");
    expect(pause.status()).toBe(200);
    expectedVersion = Number(((await pause.json()).data as Record<string, unknown>).version);
    const pausedCall = await api.post(`${baseURL}/v1/messages`, {
      headers: { "content-type": "application/json", "x-api-key": plaintextKey },
      data: { model: "subscription-model", max_tokens: 16, messages: [{ role: "user", content: "blocked" }] },
    });
    expect(pausedCall.status()).toBe(403);
    const pausedBody = await pausedCall.json();
    expect(pausedBody).toMatchObject({
      type: "error",
      error: { code: "SUBSCRIPTION_PAUSED", type: "permission_error" },
    });
    const pausedRequestId = pausedCall.headers()["x-request-id"];
    expect(pausedRequestId).toBeTruthy();
    const pausedPayload = await api.get(`${baseURL}/api/admin/gateway-requests/${encodeURIComponent(pausedRequestId)}/payload`, {
      headers: { "x-gateway-payload-confirmation": "reveal" },
    });
    expect(pausedPayload.status()).toBe(200);
    await expect(pausedPayload.json()).resolves.toMatchObject({
      data: {
        summary: { id: pausedRequestId, status: "rejected", outcome: "failed", http_status: 403, error_code: "SUBSCRIPTION_PAUSED" },
        request: { completion_status: "complete", body_json: { model: "subscription-model", messages: [{ role: "user", content: "blocked" }] } },
        response: { completion_status: "complete", http_status: 403, body_json: { type: "error", error: { code: "SUBSCRIPTION_PAUSED" } } },
      },
    });
    const resume = await command("resume", "resume:subscription:e2e");
    expect(resume.status()).toBe(200);
    expectedVersion = Number(((await resume.json()).data as Record<string, unknown>).version);

    const cancel = await command("cancel", "cancel:subscription:e2e");
    expect(cancel.status()).toBe(200);
    const cancelledSubscription = (await cancel.json()).data as Record<string, unknown>;
    expect(cancelledSubscription.status).toBe("cancel_at_period_end");
    expectedVersion = Number(cancelledSubscription.version);

    const revokeCancel = await command(
      "revoke_cancel",
      "revoke-cancel:subscription:e2e",
    );
    expect(revokeCancel.status()).toBe(200);
    const cancellationRevoked = (await revokeCancel.json()).data as Record<string, unknown>;
    expect(cancellationRevoked).toMatchObject({ status: "active" });

    const events = await api.get(`${baseURL}/api/admin/subscription-events?filter[subscription_id][eq]=${encodeURIComponent(subscriptionId)}`);
    expect(events.status()).toBe(200);
    expect((await events.json()).meta.total).toBe(8);
    expect((await api.delete(`${baseURL}/api/admin/subscriptions/${subscriptionId}`, { headers })).status()).toBe(405);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/subscriptions/versions");
    await expect(page.getByRole("heading", { name: "套餐版本", exact: true }).first()).toBeVisible();
    for (const forbidden of ["金额额度", "基础价格", "币种", "生效时间", "现金兜底"]) {
      await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
    }
    for (const forbidden of ["价格", "币种", "金额额度", "现金兜底", "支付"]) {
      expect(await page.locator("body").innerText()).not.toContain(forbidden);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("subscription-versions-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/subscriptions/token-ledger");
    await expect(page.getByRole("heading", { name: "Token 流水", exact: true })).toBeVisible();
    await expect(page.getByText(successfulGatewayRequestId, { exact: true }).first()).toBeVisible();
    for (const type of ["reserve", "capture", "release"]) {
      await expect(page.getByText(type, { exact: true })).toBeVisible();
    }
    expect(await page.locator("body").innerText()).not.toMatch(/micro-?usd|付款成功|支付成功/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("subscription-token-ledger-desktop-1440x1000.png"), fullPage: true });

    await page.goto("/admin/subscriptions/users");
    await expect(page.getByRole("heading", { name: "用户订阅", exact: true })).toBeVisible();
    const platformUserSelect = page.getByLabel("平台用户", { exact: true });
    await expect(platformUserSelect).toContainText("creator@example.test");
    await expect(platformUserSelect).toContainText("other@example.test");
    await expect(
      page
        .getByRole("region", { name: "用户订阅清单" })
        .getByText("creator@example.test", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/subscriptions/versions");
    await expect(page.getByRole("heading", { name: "套餐版本", exact: true }).first()).toBeVisible();
    for (const forbidden of ["金额额度", "基础价格", "币种", "生效时间", "现金兜底"]) {
      await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
    }
    for (const forbidden of ["价格", "币种", "金额额度", "现金兜底", "支付"]) {
      expect(await page.locator("body").innerText()).not.toContain(forbidden);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("subscription-versions-mobile-390x844.png") });
    await page.goto("/admin/subscriptions/token-ledger");
    await expect(page.getByRole("heading", { name: "Token 流水", exact: true })).toBeVisible();
    await expect(page.getByText(successfulGatewayRequestId, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("subscription-token-ledger-mobile-390x844.png") });
    expect(diagnostics).toEqual([]);
  });
});
