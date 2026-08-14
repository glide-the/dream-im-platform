// [Input] Admin database configuration plus optional Free model/token policy.
// [Output] Idempotent default Plan data and a forward-only published Free snapshot.
// [Pos] Release gate and data seed for Dream registration defaults.
// [Sync] 2026-08-14: allow a provider-ready priced model to bootstrap its first
//                    entitlement and publish a successor when the prior default
//                    model is no longer eligible.
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const TRANSITION_MANAGED_FREE = process.argv.includes(
  "--transition-managed-free-subscriptions",
);
// Matches the existing canonical-user daily default and exceeds the measured
// Claude Agent initial reservation (71,971 Token for the current Free model).
const DEFAULT_FREE_MONTHLY_TOKENS = 100_000;
const PLAN_DEFINITIONS = [
  {
    code: "free",
    name: "Free",
    eyebrow: "A quiet beginning",
    note: "从一段创作目标开始",
    details: ["查看已有 Deck", "发起有限次数的 Dream", "保留最近的工作台入口"],
  },
  {
    code: "dream",
    name: "Dream",
    eyebrow: "For active stories",
    note: "给持续创作留出空间",
    details: ["更充足的 Dream 创作额度", "更长的 Dream Agent 对话历史", "优先体验新的创作工作台能力"],
  },
  {
    code: "is-dreaming",
    name: "is Dreaming",
    eyebrow: "For ongoing worlds",
    note: "为长期作品准备的工作台",
    details: ["面向多部作品的持续创作支持", "更完整的 Deck 与工作台协作空间", "适合正在形成中的故事世界"],
  },
];

function databaseUrl() {
  const useTestDatabase = process.env.INK_USE_TEST_DATABASE_URL === "1";
  const raw = useTestDatabase
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!raw) throw new Error(useTestDatabase
    ? "TEST_DATABASE_URL is required"
    : "DATABASE_URL is required");
  const parsed = new URL(raw);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const testMarkers = new Set(databaseName.toLowerCase().split(/[^a-z0-9]+/));
  if (!localHosts.has(parsed.hostname)
    || (useTestDatabase
      ? !["codex", "test", "tests", "tmp", "temp", "ci", "sandbox"]
        .some((marker) => testMarkers.has(marker))
      : databaseName !== "ink-memory")) {
    throw new Error("Default Dream plan seed rejected the database safety identity");
  }
  return raw;
}

function requestedFreeMonthlyTokens() {
  const raw = process.env.INK_FREE_PLAN_MONTHLY_TOKENS;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("INK_FREE_PLAN_MONTHLY_TOKENS must be a positive safe integer");
  }
  return parsed;
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

async function ensurePlan(client, definition) {
  const id = `plan_default_${definition.code.replaceAll("-", "_")}`;
  await client.query(
    `INSERT INTO subscription_plans (
       id, code, name, display_eyebrow, display_note, display_details, status
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'active')
     ON CONFLICT (code) DO NOTHING`,
    [id, definition.code, definition.name, definition.eyebrow,
      definition.note, JSON.stringify(definition.details)],
  );
  const result = await client.query(
    `SELECT id, name, display_eyebrow, display_note, display_details
     FROM subscription_plans WHERE code = $1 FOR UPDATE`,
    [definition.code],
  );
  const row = result.rows[0];
  if (!row
    || row.name !== definition.name
    || row.display_eyebrow !== definition.eyebrow
    || row.display_note !== definition.note
    || !sameStringArray(row.display_details, definition.details)) {
    throw new Error(`Plan ${definition.code} exists with conflicting identity/display fields`);
  }
  return row.id;
}

async function selectFreeModel(client) {
  const configuredAlias = process.env.INK_FREE_PLAN_MODEL_ALIAS?.trim() || null;
  const result = await client.query(
    `SELECT model.id, model.code
     FROM ai_models AS model
     JOIN ai_providers AS provider ON provider.id = model.provider_id
     LEFT JOIN LATERAL (
       SELECT version.version_number
       FROM subscription_plan_entitlements AS entitlement
       JOIN subscription_plan_versions AS version
         ON version.id = entitlement.plan_version_id
       JOIN subscription_plans AS plan ON plan.id = version.plan_id
       WHERE entitlement.model_id = model.id
         AND entitlement.enabled = TRUE
         AND entitlement.is_default = TRUE
         AND entitlement.gateway_scopes @> ARRAY['messages:create']::text[]
         AND version.status = 'published'
         AND plan.code = 'free'
         AND plan.status = 'active'
       ORDER BY version.version_number DESC
       LIMIT 1
     ) AS current_free ON TRUE
     WHERE model.enabled = TRUE
       AND provider.status = 'active'
       AND provider.api_key_ciphertext IS NOT NULL
       AND provider.api_key_iv IS NOT NULL
       AND provider.api_key_tag IS NOT NULL
       AND ($1::text IS NULL OR model.code = $1)
       AND EXISTS (
         SELECT 1 FROM ai_pricing_rules AS pricing
         WHERE pricing.model_id = model.id
           AND pricing.status = 'active'
           AND pricing.user_tier IN ('free', 'default')
           AND pricing.effective_from <= NOW()
           AND (pricing.effective_to IS NULL OR pricing.effective_to > NOW())
       )
     ORDER BY
       CASE WHEN $1::text IS NULL THEN current_free.version_number END DESC NULLS LAST,
       model.code ASC
     LIMIT 1`,
    [configuredAlias],
  );
  if (!result.rows[0]) {
    throw new Error("No enabled, provider-ready model with active free/default pricing is eligible for the Free Plan");
  }
  return result.rows[0];
}

async function ensureFreeVersion(client, planId, model, allowanceTokens) {
  const existing = await client.query(
    `SELECT version.id, version.version_number, version.status, version.allowance_tokens,
            entitlement.model_id, entitlement.is_default,
            entitlement.gateway_scopes
     FROM subscription_plan_versions AS version
     LEFT JOIN subscription_plan_entitlements AS entitlement
       ON entitlement.plan_version_id = version.id
      AND entitlement.is_default = TRUE
     WHERE version.plan_id = $1
     ORDER BY version.version_number DESC
     LIMIT 1
     FOR UPDATE OF version`,
    [planId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    const managedDraft = row.status === "draft"
      && row.id === "planv_default_free_v1"
      && Number(row.version_number) === 1
      && Number(row.allowance_tokens) > 0
      && (allowanceTokens === null
        || Number(row.allowance_tokens) === allowanceTokens);
    if (managedDraft) {
      if (row.model_id === null) {
        await client.query(
          `INSERT INTO subscription_plan_entitlements (
             id, plan_version_id, model_id, gateway_scopes,
             is_default, enabled
           ) VALUES ($1,$2,$3,$4,TRUE,TRUE)`,
          ["ent_default_free_v1", row.id, model.id, ["messages:create", "models:list"]],
        );
      } else if (row.model_id !== model.id
        || row.is_default !== true
        || !Array.isArray(row.gateway_scopes)
        || !row.gateway_scopes.includes("messages:create")) {
        throw new Error("Managed Free draft has a conflicting Entitlement");
      }
      await client.query(
        `UPDATE subscription_plan_versions
         SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'draft'`,
        [row.id],
      );
      return row.id;
    }
    if (row.status === "draft") {
      throw new Error("Existing unmanaged Free Plan draft blocks automatic publication");
    }
    const reusablePublishedSnapshot = row.status === "published"
      && Number(row.allowance_tokens) > 0
      && row.model_id === model.id
      && row.is_default === true
      && Array.isArray(row.gateway_scopes)
      && row.gateway_scopes.includes("messages:create")
      && (allowanceTokens === null
        || Number(row.allowance_tokens) === allowanceTokens);
    if (reusablePublishedSnapshot) return row.id;
  }

  const versionNumber = existing.rows[0]
    ? Number(existing.rows[0].version_number) + 1
    : 1;
  const versionId = `planv_default_free_v${versionNumber}`;
  const versionAllowanceTokens = allowanceTokens ?? DEFAULT_FREE_MONTHLY_TOKENS;
  await client.query(
    `INSERT INTO subscription_plan_versions (
       id, plan_id, version_number, status, billing_period,
       base_price_microusd, allowance_tokens, allowance_microusd,
       overage_policy, effective_from
     ) VALUES ($1,$2,$3,'draft','monthly',0,$4,0,'deny',NULL)`,
    [versionId, planId, versionNumber, versionAllowanceTokens],
  );
  await client.query(
    `INSERT INTO subscription_plan_entitlements (
       id, plan_version_id, model_id, gateway_scopes,
       is_default, enabled
     ) VALUES ($1,$2,$3,$4,TRUE,TRUE)`,
    [`ent_default_free_v${versionNumber}`, versionId, model.id, ["messages:create", "models:list"]],
  );
  await client.query(
    `UPDATE subscription_plan_versions
     SET status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'draft'`,
    [versionId],
  );
  return versionId;
}

async function transitionManagedFreeSubscriptions(client, planId, targetVersionId) {
  const candidates = await client.query(
    `SELECT subscription.id, platform.external_user_id
     FROM subscriptions AS subscription
     JOIN platform_users AS platform ON platform.id = subscription.platform_user_id
     JOIN subscription_plan_versions AS version ON version.id = subscription.plan_version_id
     WHERE version.plan_id = $1
       AND subscription.plan_version_id <> $2
       AND subscription.id LIKE 'sub_free_%'
       AND platform.source = 'ink-dream'
       AND platform.external_user_id ~ '^[1-9][0-9]{0,18}$'
       AND subscription.status = 'active'
     ORDER BY subscription.id
     FOR UPDATE OF subscription`,
    [planId, targetVersionId],
  );
  let transitioned = 0;
  for (const row of candidates.rows) {
    await client.query(
      `UPDATE subscriptions
       SET status = 'cancelled', renewal_enabled = FALSE,
           cancelled_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [row.id],
    );
    await client.query(
      `INSERT INTO subscription_events (
         id, subscription_id, event_type, idempotency_key,
         actor_type, actor_id, reason, metadata
       ) VALUES (
         'subevt_free_transition_' || md5($1 || ':' || $2),
         $1, 'plan_changed', 'default-free-transition:' || $1 || ':' || $2,
         'system', 'default-free-provisioner',
         'Superseded by a newer published Free Plan Version',
         jsonb_build_object('targetPlanVersionId', $2, 'source', 'default-free-forward-fix')
       )
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [row.id, targetVersionId],
    );
    const provisioned = await client.query(
      `SELECT public.provision_default_free_subscription($1::bigint) AS id`,
      [row.external_user_id],
    );
    if (!provisioned.rows[0]?.id) {
      throw new Error("Unable to forward-transition a managed Free subscription");
    }
    transitioned += 1;
  }
  return transitioned;
}

async function ensureDraftVersion(client, planId, code) {
  const existing = await client.query(
    `SELECT id, status FROM subscription_plan_versions
     WHERE plan_id = $1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
    [planId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const versionId = `planv_default_${code.replaceAll("-", "_")}_v1`;
  await client.query(
    `INSERT INTO subscription_plan_versions (
       id, plan_id, version_number, status, billing_period,
       base_price_microusd, allowance_tokens, allowance_microusd,
       overage_policy, effective_from
     ) VALUES ($1,$2,1,'draft','monthly',0,0,0,'deny',NULL)`,
    [versionId, planId],
  );
  return versionId;
}

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('default-dream-plans-v1', 0))");
  const planIds = new Map();
  for (const definition of PLAN_DEFINITIONS) {
    planIds.set(definition.code, await ensurePlan(client, definition));
  }
  const model = await selectFreeModel(client);
  const freeVersionId = await ensureFreeVersion(
    client,
    planIds.get("free"),
    model,
    requestedFreeMonthlyTokens(),
  );
  const freeVersion = await client.query(
    `SELECT allowance_tokens FROM subscription_plan_versions WHERE id = $1`,
    [freeVersionId],
  );
  const transitionedFreeSubscriptions = TRANSITION_MANAGED_FREE
    ? await transitionManagedFreeSubscriptions(
        client,
        planIds.get("free"),
        freeVersionId,
      )
    : 0;
  await ensureDraftVersion(client, planIds.get("dream"), "dream");
  await ensureDraftVersion(client, planIds.get("is-dreaming"), "is-dreaming");

  const backfill = await client.query(
    `SELECT count(result)::int AS count
     FROM (
       SELECT public.provision_default_free_subscription(user_row.id) AS result
       FROM users AS user_row
       ORDER BY user_row.id
     ) AS provisioned
     WHERE result IS NOT NULL`,
  );
  const receipt = {
    mode: APPLY ? "applied" : "dry-run",
    plans: PLAN_DEFINITIONS.map(({ code }) => code),
    freePlanVersion: freeVersionId,
    freeModelAlias: model.code,
    freeMonthlyTokens: Number(freeVersion.rows[0].allowance_tokens),
    backfilledSubscriptions: backfill.rows[0]?.count ?? 0,
    transitionedFreeSubscriptions,
  };
  if (APPLY) await client.query("COMMIT");
  else await client.query("ROLLBACK");
  console.log(JSON.stringify(receipt));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
