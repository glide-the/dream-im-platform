// [Input] Primary-prepared, fully migrated disposable PostgreSQL with its real foreign keys and ledger triggers.
// [Output] Cross-process account serialization, forced interleavings, rollback, conservation and idempotent finalization evidence.
// [Pos] Provider-free database contract invoking the production Gateway/Billing entry points; no alternate business path.
// [Sync] 2026-10-03: include account advisory-lock waits and high-contention same-user preauthorization/settlement.
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePoolForTests, getPool } from "../db";
import { withPlatformTransaction } from "../platform-db";
import { settleGatewayRequest, settleGatewayRequestOnClient } from "../billing/repository";
import type { ResolvedBillableModel } from "../models/resolver";
import type { GatewayPrincipal } from "./auth";
import { lockGatewayAccountOnClient } from "./account-lock";
import { beginGatewayRequest } from "./repository";

beforeAll(async () => {
  const file = process.env.INK_GATEWAY_DEADLOCK_FIXTURE;
  if (!file) return;
  const mode = (await stat(file)).mode & 0o777;
  expect(mode).toBe(0o600);
  const fixture = JSON.parse(await readFile(file, "utf8"));
  const url = new URL(fixture.connectionString);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname.slice(1)).toMatch(/^ink_gateway_deadlock_test_[a-f0-9]+$/);
  process.env.TEST_DATABASE_URL = fixture.connectionString;
  process.env.INK_USE_TEST_DATABASE_URL = "1";
  const topology = await getPool().query("SELECT current_database() AS name, current_setting('data_directory') AS dir");
  expect(topology.rows[0]).toEqual({ name: fixture.databaseName, dir: fixture.dataDir });
});
afterAll(closePoolForTests);

async function fixture(granted = 10_000) {
  const suffix = randomUUID().replaceAll("-", "");
  const ids = Object.fromEntries(["provider", "key", "plan", "version", "subscription", "allowance"]
    .map(name => [name, `${name}_${suffix}`]));
  const pool = getPool();
  const canonical = await pool.query(`INSERT INTO users (email, password_hash, display_name, role)
    VALUES ($1, 'isolated-fixture', 'Deadlock contract', 'user') RETURNING id`, [`${suffix}@example.test`]);
  const user = await pool.query("SELECT id FROM platform_users WHERE external_user_id = $1", [String(canonical.rows[0].id)]);
  const userId = String(user.rows[0].id);
  await pool.query(`INSERT INTO ai_providers (id, code, name, protocol, status, base_url)
    VALUES ($1, $1, 'Resolved fixture only', 'openai', 'disabled', 'http://127.0.0.1:1')`, [ids.provider]);
  await pool.query(`INSERT INTO gateway_api_keys (id, platform_user_id, name, key_prefix, key_hash, scopes)
    VALUES ($1, $2, 'Isolated fixture', 'fixture', $1, ARRAY['chat:completions:create'])`, [ids.key, userId]);
  await pool.query("INSERT INTO subscription_plans (id, code, name) VALUES ($1, $1, 'Deadlock fixture')", [ids.plan]);
  await pool.query(`INSERT INTO subscription_plan_versions (id, plan_id, version_number, status, allowance_tokens)
    VALUES ($1, $2, 1, 'published', $3)`, [ids.version, ids.plan, granted]);
  await pool.query(`INSERT INTO subscriptions (id, platform_user_id, plan_version_id, status, current_period_start, current_period_end, cycle_anchor_at)
    VALUES ($1, $2, $3, 'active', NOW() - INTERVAL '1 day', (NOW() - INTERVAL '1 day') + INTERVAL '1 month', NOW() - INTERVAL '1 day')`, [ids.subscription, userId, ids.version]);
  await pool.query(`INSERT INTO subscription_usage_allowances
    (id, subscription_id, plan_version_id, period_number, period_start, period_end, granted_tokens)
    SELECT $1, id, plan_version_id, current_period_number, current_period_start, current_period_end, $3
    FROM subscriptions WHERE id = $2`, [ids.allowance, ids.subscription, granted]);
  const models: ResolvedBillableModel[] = [];
  for (const index of [0, 1]) {
    const id = `model_${suffix}_${index}`;
    const pricingId = `pricing_${suffix}_${index}`;
    await pool.query(`INSERT INTO ai_models (id, provider_id, code, upstream_model, display_name)
      VALUES ($1, $2, $1, $1, 'Resolved fixture')`, [id, ids.provider]);
    await pool.query(`INSERT INTO ai_pricing_rules (id, model_id, input_price_microusd_per_million,
      output_price_microusd_per_million, effective_from) VALUES ($1, $2, 0, 0, NOW())`, [pricingId, id]);
    for (const type of ["day", "month"]) {
      await pool.query(`INSERT INTO gateway_rate_limits (platform_user_id, model_id, window_type, window_start)
        VALUES ($1, $2, $3, date_trunc($3, NOW()))`, [userId, id, type]);
    }
    models.push({
      model: { id, code: id, upstreamModel: id, displayName: "Resolved fixture", capabilities: {}, requestHeaders: {} },
      provider: { id: ids.provider, code: ids.provider, protocol: "openai", baseUrl: null, timeoutMs: 1000, maxRetries: 0, config: {} },
      pricingRuleId: pricingId,
      pricing: { inputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0,
        cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0 },
      limits: {},
    });
  }
  const principal: GatewayPrincipal = { apiKeyId: ids.key, platformUserId: userId,
    source: "ink-memory", externalUserId: String(canonical.rows[0].id), tier: "free", scopes: ["chat:completions:create"] };
  function begin(index = 0, tokens = 100, idempotencyKey?: string) {
    return beginGatewayRequest({ principal, resolved: models[index], requestedModel: models[index].model.code,
      protocol: "openai", isStreaming: false, reservationMicrousd: 0, estimatedTokens: tokens,
      requiredScope: "chat:completions:create", limits: {}, idempotencyKey });
  }
  return { allowance: ids.allowance, userId, models, begin };
}

async function waitForBlocked(count: number) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await getPool().query(`SELECT count(*)::integer AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND (query LIKE '%gateway_rate_limits%'
          OR query LIKE '%pg_advisory_xact_lock%')`);
    if (result.rows[0].n >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Controlled window wait was not reached");
}

async function gated<T>(f: Awaited<ReturnType<typeof fixture>>, actions: (() => Promise<T>)[]) {
  const gate = await getPool().connect();
  let running: Promise<PromiseSettledResult<T>[]> | undefined;
  try {
    await gate.query("BEGIN");
    await gate.query(`SELECT model_id FROM gateway_rate_limits WHERE platform_user_id = $1
      AND window_type = 'day' ORDER BY model_id FOR UPDATE`, [f.userId]);
    running = Promise.allSettled(actions.map(action => action()));
    await waitForBlocked(actions.length);
    await gate.query("COMMIT");
    return await running;
  } finally {
    await gate.query("ROLLBACK");
    gate.release();
    if (running) await running;
  }
}

function reserved(result: Awaited<ReturnType<typeof beginGatewayRequest>>) {
  expect(result.kind).toBe("reserved");
  if (result.kind !== "reserved") throw new Error("Expected reservation");
  return result.requestId;
}
function usage(tokens = 30) {
  return { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokenSemantics: "fresh" as const };
}
async function allowance(id: string) {
  const result = await getPool().query("SELECT reserved_tokens::integer AS reserved, consumed_tokens::integer AS consumed FROM subscription_usage_allowances WHERE id = $1", [id]);
  return result.rows[0];
}

describe.skipIf(!process.env.INK_GATEWAY_DEADLOCK_FIXTURE)("real PostgreSQL Gateway deadlock correctness", () => {
  it("uses one cross-connection lock per user without serializing another user", async () => {
    const first = await fixture();
    const second = await fixture();
    const gate = await getPool().connect();
    try {
      await gate.query("BEGIN");
      await lockGatewayAccountOnClient(gate, first.userId);

      await expect(withPlatformTransaction(async client => {
        await client.query("SET LOCAL lock_timeout = '200ms'");
        await lockGatewayAccountOnClient(client, second.userId);
      })).resolves.toBeUndefined();

      await expect(withPlatformTransaction(async client => {
        await client.query("SET LOCAL lock_timeout = '200ms'");
        await lockGatewayAccountOnClient(client, first.userId);
      })).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
    }
  });

  it.each([false, true])("completes both foreign-key-bound preauthorizations, cross-model=%s", async crossModel => {
    const f = await fixture();
    const results = await gated(f, [() => f.begin(0), () => f.begin(crossModel ? 1 : 0)]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    for (const result of results) if (result.status === "fulfilled") reserved(result.value);
    expect(await allowance(f.allowance)).toEqual({ reserved: 200, consumed: 0 });
  });

  it("rejects the second serialized preauthorization without over-reserving", async () => {
    const f = await fixture(150);
    const results = await gated(f, [() => f.begin(), () => f.begin()]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const fulfilled = results.flatMap(result =>
      result.status === "fulfilled" ? [result.value] : []
    );
    expect(fulfilled.filter(result => result.kind === "reserved")).toHaveLength(1);
    expect(fulfilled.filter(result => result.kind === "rejected")).toHaveLength(1);
    expect(await allowance(f.allowance)).toEqual({ reserved: 100, consumed: 0 });
    const ledger = await getPool().query("SELECT count(*)::integer AS n FROM subscription_token_ledger_entries WHERE subscription_allowance_id = $1", [f.allowance]);
    expect(ledger.rows[0].n).toBe(1);
  });

  it("allows settlement and a foreign-key-bound preauthorization to complete together", async () => {
    const f = await fixture();
    const old = reserved(await f.begin());
    const results = await gated<unknown>(f, [
      () => settleGatewayRequest({ gatewayRequestId: old, usage: usage(), outcome: "succeeded" }),
      () => f.begin(),
    ]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    expect(await allowance(f.allowance)).toEqual({ reserved: 100, consumed: 30 });
  });

  it("serializes high-contention accounting while preserving every request effect", async () => {
    const f = await fixture();
    const requests = await Promise.all(
      Array.from({ length: 8 }, async () => reserved(await f.begin())),
    );
    expect(await allowance(f.allowance)).toEqual({ reserved: 800, consumed: 0 });

    await Promise.all(requests.map(gatewayRequestId =>
      settleGatewayRequest({ gatewayRequestId, usage: usage(), outcome: "succeeded" })
    ));

    expect(await allowance(f.allowance)).toEqual({ reserved: 0, consumed: 240 });
    const ledger = await getPool().query(
      `SELECT entry_type, count(*)::integer AS entries, sum(amount_tokens)::integer AS amount
       FROM subscription_token_ledger_entries
       WHERE subscription_allowance_id = $1
       GROUP BY entry_type`,
      [f.allowance],
    );
    expect(Object.fromEntries(ledger.rows.map(row => [row.entry_type, {
      entries: row.entries,
      amount: row.amount,
    }]))).toEqual({
      reserve: { entries: 8, amount: 800 },
      capture: { entries: 8, amount: 240 },
      release: { entries: 8, amount: 560 },
    });
  });

  it("rolls rate writes back when the later allowance lock times out", async () => {
    const f = await fixture();
    const id = reserved(await f.begin());
    const gate = await getPool().connect();
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM subscription_usage_allowances WHERE id = $1 FOR UPDATE", [f.allowance]);
      await expect(withPlatformTransaction(async (client: PoolClient) => {
        await client.query("SET LOCAL lock_timeout = '200ms'");
        return settleGatewayRequestOnClient(client, { gatewayRequestId: id, usage: usage(), outcome: "succeeded" });
      })).rejects.toMatchObject({ code: "55P03" });
    } finally { await gate.query("ROLLBACK"); gate.release(); }
    const counters = await getPool().query("SELECT token_count::integer AS n FROM gateway_rate_limits WHERE platform_user_id = $1", [f.userId]);
    expect(counters.rows.map(row => row.n).sort()).toEqual([0, 0, 100, 100]);
    expect(await allowance(f.allowance)).toEqual({ reserved: 100, consumed: 0 });
    const row = await getPool().query("SELECT settled_at FROM gateway_requests WHERE id = $1", [id]);
    expect(row.rows[0].settled_at).toBeNull();
    await settleGatewayRequest({ gatewayRequestId: id, usage: usage(), outcome: "succeeded" });
    expect(await allowance(f.allowance)).toEqual({ reserved: 0, consumed: 30 });
  });

  it("settles the UTC admission windows even with a non-UTC database session", async () => {
    const f = await fixture();
    const id = reserved(await f.begin());
    await withPlatformTransaction(async client => {
      await client.query("SET LOCAL TIME ZONE 'Asia/Shanghai'");
      await settleGatewayRequestOnClient(client, { gatewayRequestId: id, usage: usage(), outcome: "succeeded" });
    });
    const counters = await getPool().query("SELECT token_count::integer AS n FROM gateway_rate_limits WHERE platform_user_id = $1", [f.userId]);
    expect(counters.rows.map(row => row.n).sort((a, b) => a - b)).toEqual([0, 0, 30, 30]);
    expect(await allowance(f.allowance)).toEqual({ reserved: 0, consumed: 30 });
  });

  it.each(["succeeded", "failed"] as const)("finalizes %s exactly once under duplicate calls", async outcome => {
    const f = await fixture();
    const id = reserved(await f.begin());
    const input = { gatewayRequestId: id, usage: usage(outcome === "failed" ? 0 : 30), outcome };
    const results = await Promise.all([settleGatewayRequest(input), settleGatewayRequest(input)]);
    expect(results.filter(result => !result.idempotent)).toHaveLength(1);
    expect(results.filter(result => result.idempotent)).toHaveLength(1);
    expect(await allowance(f.allowance)).toEqual({ reserved: 0, consumed: outcome === "failed" ? 0 : 30 });
    const rows = await getPool().query(`SELECT entry_type, sum(amount_tokens)::integer AS amount
      FROM subscription_token_ledger_entries WHERE gateway_request_id = $1 GROUP BY entry_type`, [id]);
    expect(Object.fromEntries(rows.rows.map(row => [row.entry_type, row.amount]))).toEqual(
      outcome === "failed" ? { reserve: 100, release: 100 } : { reserve: 100, capture: 30, release: 70 });
  });
});
