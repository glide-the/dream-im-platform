#!/usr/bin/env node

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(scriptDirectory, "..");
const dreamRoot = resolve(adminRoot, "../ink-dream-memory");
const adminEnvPath = resolve(adminRoot, ".env.local");
const dreamEnvPath = resolve(dreamRoot, "backend/.env");
const serviceClientId = "ink-dream-memory";
const issuer = "ink-dream-memory";
const audience = "ink-memory-admin-gateway";
const testEmail = "codex-gateway-e2e@ink-memory.test";
const testPlanCode = "local-gateway-e2e";
const testAllowanceTokens = 5_000_000;

if (!process.argv.includes("--apply")) {
  throw new Error("Refusing to mutate local state without --apply");
}

loadDotenv({ path: adminEnvPath, quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const pepper = process.env.GATEWAY_API_KEY_PEPPER;
if (!databaseUrl || !pepper || Buffer.byteLength(pepper, "utf8") < 32) {
  throw new Error("Admin DATABASE_URL and Gateway key pepper must be configured");
}
const parsedDatabaseUrl = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1", "::1"].includes(parsedDatabaseUrl.hostname) ||
  decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")) !== "ink-memory"
) {
  throw new Error("This command is restricted to the local ink-memory database");
}

function platformId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function encodeEnvValue(value) {
  if (/^[A-Za-z0-9_./:@%+,=\-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

async function updatePrivateEnv(path, updates) {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  const remaining = new Map(updates);
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${encodeEnvValue(value)}`;
  });
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  if (remaining.size > 0) {
    lines.push("", "# Local Dream to Admin Gateway integration (server-only).");
    for (const [key, value] of remaining) {
      lines.push(`${key}=${encodeEnvValue(value)}`);
    }
  }
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

const plaintextKey = `gw_${randomBytes(32).toString("base64url")}`;
const keyPrefix = plaintextKey.slice(0, 12);
const keyHash = createHmac("sha256", pepper)
  .update(plaintextKey, "utf8")
  .digest("hex");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
let receipt;

try {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    ["provision-local-dream-gateway"],
  );

  const callableModelResult = await client.query(
    `SELECT model.id, model.code
       FROM ai_models AS model
       JOIN ai_providers AS provider
         ON provider.id = model.provider_id
        AND provider.status = 'active'
        AND provider.api_key_ciphertext IS NOT NULL
        AND provider.api_key_iv IS NOT NULL
        AND provider.api_key_tag IS NOT NULL
      WHERE model.enabled = TRUE
        AND EXISTS (
          SELECT 1 FROM ai_pricing_rules AS pricing
           WHERE pricing.model_id = model.id
             AND pricing.status = 'active'
             AND pricing.user_tier IN ('free', 'default')
             AND pricing.effective_from <= NOW()
             AND (pricing.effective_to IS NULL OR pricing.effective_to > NOW())
        )
      ORDER BY model.display_name, model.code
      LIMIT 1
      FOR SHARE OF model`,
  );
  const callableModel = callableModelResult.rows[0];
  if (!callableModel) throw new Error("No callable Gateway model is configured");

  await client.query(
    `INSERT INTO subscription_plans (id, code, name, description, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (code) DO NOTHING`,
    [
      platformId("plan"),
      testPlanCode,
      "Local Gateway E2E",
      "Local-only Token allowance for real Gateway and Claude Agent verification",
    ],
  );
  const planResult = await client.query(
    "SELECT id FROM subscription_plans WHERE code = $1 FOR UPDATE",
    [testPlanCode],
  );
  const testPlanId = planResult.rows[0]?.id;
  if (!testPlanId) throw new Error("Unable to provision the local E2E plan");

  let versionResult = await client.query(
    `SELECT version.id, version.allowance_tokens
       FROM subscription_plan_versions AS version
       JOIN subscription_plan_entitlements AS entitlement
         ON entitlement.plan_version_id = version.id
        AND entitlement.model_id = $2
        AND entitlement.enabled = TRUE
        AND entitlement.gateway_scopes @> ARRAY['models:list', 'messages:create']::text[]
      WHERE version.plan_id = $1
        AND version.status = 'published'
        AND version.billing_period = 'monthly'
        AND version.allowance_tokens >= $3
        AND version.allowance_microusd = 0
        AND version.overage_policy = 'deny'
        AND version.effective_from IS NULL
      ORDER BY version.version_number DESC
      LIMIT 1
      FOR SHARE OF version`,
    [testPlanId, callableModel.id, testAllowanceTokens],
  );
  if (!versionResult.rows[0]) {
    const versionId = platformId("planv");
    await client.query(
      `INSERT INTO subscription_plan_versions (
         id, plan_id, version_number, status, billing_period,
         base_price_microusd, trial_days, grace_period_days,
         allowance_tokens, allowance_microusd, overage_policy, effective_from
       )
       SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, 'draft', 'monthly',
              0, 0, 0, $3, 0, 'deny', NULL
         FROM subscription_plan_versions WHERE plan_id = $2`,
      [versionId, testPlanId, testAllowanceTokens],
    );
    await client.query(
      `INSERT INTO subscription_plan_entitlements (
         id, plan_version_id, model_id, gateway_scopes,
         requests_per_minute, daily_token_limit, monthly_token_limit,
         storage_bytes_limit, enabled
       ) VALUES ($1, $2, $3, $4, 60, NULL, NULL, NULL, TRUE)`,
      [
        platformId("ent"),
        versionId,
        callableModel.id,
        ["models:list", "messages:create", "chat:create"],
      ],
    );
    await client.query(
      `UPDATE subscription_plan_versions
          SET status = 'published', published_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'draft'`,
      [versionId],
    );
    versionResult = await client.query(
      "SELECT id, allowance_tokens FROM subscription_plan_versions WHERE id = $1 FOR SHARE",
      [versionId],
    );
  }
  const planVersion = versionResult.rows[0];
  if (!planVersion) throw new Error("Unable to provision a callable local E2E plan version");

  await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
  let userResult = await client.query(
    "SELECT id::text FROM users WHERE email = $1",
    [testEmail],
  );
  let userCreated = false;
  if (!userResult.rows[0]) {
    userResult = await client.query(
      `INSERT INTO users (id, email, password_hash, display_name, role, status)
       SELECT COALESCE(MAX(id), 0) + 1, $1, $2, $3, 'user', 'active'
         FROM users
       RETURNING id::text`,
      [testEmail, "!local-e2e-login-disabled!", "Gateway E2E User"],
    );
    userCreated = true;
  }
  const canonicalUserId = userResult.rows[0].id;
  const projectionResult = await client.query(
    `SELECT platform.id
       FROM platform_users AS platform
       JOIN billing_accounts AS account ON account.platform_user_id = platform.id
      WHERE platform.source = 'ink-dream'
        AND platform.external_user_id = $1
        AND platform.status = 'active'
      FOR SHARE OF platform`,
    [canonicalUserId],
  );
  const platformUserId = projectionResult.rows[0]?.id;
  if (!platformUserId) {
    throw new Error("Canonical user billing projection was not created");
  }
  await client.query(
    `UPDATE platform_users
        SET daily_token_limit = $2,
            monthly_token_limit = $2,
            updated_at = NOW()
      WHERE id = $1
        AND source = 'ink-dream'
        AND external_user_id = $3`,
    [platformUserId, testAllowanceTokens, canonicalUserId],
  );

  const replacedSubscriptions = await client.query(
    `UPDATE subscriptions
        SET status = 'cancelled', renewal_enabled = FALSE,
            cancelled_at = NOW(), version = version + 1, updated_at = NOW()
      WHERE platform_user_id = $1
        AND plan_version_id <> $2
        AND status IN ('trial', 'active', 'past_due', 'paused', 'cancel_at_period_end')
      RETURNING id`,
    [platformUserId, planVersion.id],
  );
  for (const replaced of replacedSubscriptions.rows) {
    await client.query(
      `INSERT INTO subscription_events (
         id, subscription_id, event_type, idempotency_key,
         actor_type, reason, metadata
       ) VALUES ($1, $2, 'cancelled', $3, 'system', $4, $5::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        platformId("subevt"),
        replaced.id,
        `local-e2e:replace:${replaced.id}`,
        "Replace undersized local E2E Token allowance",
        JSON.stringify({ localE2E: true }),
      ],
    );
  }

  let subscriptionResult = await client.query(
    `SELECT subscription.id
       FROM subscriptions AS subscription
      WHERE subscription.platform_user_id = $1
        AND subscription.plan_version_id = $2
        AND subscription.status IN ('active', 'cancel_at_period_end')
        AND subscription.current_period_start <= NOW()
        AND subscription.current_period_end > NOW()
      ORDER BY subscription.created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [platformUserId, planVersion.id],
  );
  let subscriptionCreated = false;
  if (!subscriptionResult.rows[0]) {
    const subscriptionId = platformId("sub");
    subscriptionResult = await client.query(
      `INSERT INTO subscriptions (
         id, platform_user_id, plan_version_id, status,
         current_period_start, current_period_end, cycle_anchor_at,
         current_period_number, renewal_enabled
       ) VALUES (
         $1, $2, $3, 'active', NOW(), NOW() + INTERVAL '1 month',
         NOW(), 0, TRUE
       ) RETURNING id`,
      [subscriptionId, platformUserId, planVersion.id],
    );
    const allowanceId = platformId("allow");
    await client.query(
      `INSERT INTO subscription_usage_allowances (
         id, subscription_id, plan_version_id, period_number,
         period_start, period_end, granted_tokens
       )
       SELECT $1, id, plan_version_id, current_period_number,
              current_period_start, current_period_end, $3
         FROM subscriptions WHERE id = $2`,
      [allowanceId, subscriptionId, planVersion.allowance_tokens],
    );
    await client.query(
      `INSERT INTO subscription_events (
         id, subscription_id, event_type, idempotency_key,
         actor_type, reason, metadata
       ) VALUES ($1, $2, 'activated', $3, 'system', $4, $5::jsonb)`,
      [
        platformId("subevt"),
        subscriptionId,
        `local-e2e:activate:${subscriptionId}`,
        "Local Admin Gateway end-to-end verification",
        JSON.stringify({ localE2E: true }),
      ],
    );
    subscriptionCreated = true;
  }

  const modelResult = await client.query(
    `SELECT model.code
       FROM subscriptions AS subscription
       JOIN subscription_plan_versions AS version ON version.id = subscription.plan_version_id
       JOIN subscription_plan_entitlements AS entitlement
         ON entitlement.plan_version_id = version.id
        AND entitlement.enabled = TRUE
        AND entitlement.gateway_scopes @> ARRAY['models:list', 'messages:create']::text[]
       JOIN ai_models AS model ON model.id = entitlement.model_id AND model.enabled = TRUE
       JOIN ai_providers AS provider
         ON provider.id = model.provider_id
        AND provider.status = 'active'
        AND provider.api_key_ciphertext IS NOT NULL
        AND provider.api_key_iv IS NOT NULL
        AND provider.api_key_tag IS NOT NULL
      WHERE subscription.id = $1
        AND EXISTS (
          SELECT 1 FROM ai_pricing_rules AS pricing
           WHERE pricing.model_id = model.id
             AND pricing.status = 'active'
             AND pricing.user_tier IN ('free', 'default')
             AND pricing.effective_from <= NOW()
             AND (pricing.effective_to IS NULL OR pricing.effective_to > NOW())
        )
      ORDER BY model.display_name, model.code
      LIMIT 1`,
    [subscriptionResult.rows[0].id],
  );
  const modelAlias = modelResult.rows[0]?.code;
  if (!modelAlias) throw new Error("The local E2E subscription has no callable model");

  await client.query(
    `UPDATE gateway_api_keys
        SET status = 'revoked', revoked_at = NOW()
      WHERE subject_mode = 'canonical_subject'
        AND service_client_id = $1
        AND revoked_at IS NULL`,
    [serviceClientId],
  );
  await client.query(
    `INSERT INTO gateway_api_keys (
       id, platform_user_id, subject_mode, service_client_id,
       name, key_prefix, key_hash, scopes
     ) VALUES ($1, NULL, 'canonical_subject', $2, $3, $4, $5, $6)`,
    [
      platformId("gkey"),
      serviceClientId,
      "Ink Dream local server",
      keyPrefix,
      keyHash,
      ["models:list", "messages:create", "chat:create"],
    ],
  );
  await client.query("COMMIT");
  receipt = { userCreated, subscriptionCreated, canonicalUserId, modelAlias };
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

await updatePrivateEnv(adminEnvPath, new Map([
  ["GATEWAY_SUBJECT_JWT_ISSUER", issuer],
  ["GATEWAY_SUBJECT_JWT_AUDIENCE", audience],
]));
await updatePrivateEnv(dreamEnvPath, new Map([
  ["INK_GATEWAY_ENABLED", "1"],
  ["INK_GATEWAY_BASE_URL", "http://127.0.0.1:3000"],
  ["INK_GATEWAY_SERVICE_KEY", plaintextKey],
  ["INK_GATEWAY_SUBJECT_JWT_ISSUER", issuer],
  ["INK_GATEWAY_SUBJECT_JWT_AUDIENCE", audience],
  ["INK_GATEWAY_SERVICE_CLIENT_ID", serviceClientId],
  ["INK_GATEWAY_SUBJECT_TOKEN_LIFETIME_SECONDS", "240"],
  ["INK_GATEWAY_TEXT_MODEL_ALIAS", receipt.modelAlias],
]));

console.log(JSON.stringify({
  database: "local ink-memory",
  serviceClientId,
  scopes: ["models:list", "messages:create", "chat:create"],
  modelAlias: receipt.modelAlias,
  testUserCreated: receipt.userCreated,
  testSubscriptionCreated: receipt.subscriptionCreated,
  secretPersistence: "database-hmac-and-mode-0600-env-only",
}));
