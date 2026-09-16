// [Input] Private explicit owned disposable PG configuration and reviewed identity adoption manifest.
// [Output] Default dry-run/inspect or same-transaction Dream subject/account mapping with aggregate audit.
// [Pos] Explicit Dream legacy identity runner; Admin operators cannot enter this adoption path.
// [Sync] 2026-09-17: preserve Dream PK/hash/body/subscription while rejecting all Admin-domain adoption.
import { readFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { adoptionManifestDto, legacySourceFingerprint, planSubjectAdoption } from "./auth-subject-adoption-core.ts";
import identityContract from "../contracts/identity-better-auth-v1.json" with { type: "json" };
const privateJson = text => { try { return JSON.parse(text); } catch { throw new Error("Invalid private configuration JSON"); } };
const args = process.argv.slice(2);
if (args.some(arg => !["--apply", "--inspect"].includes(arg)) || args.includes("--apply") && args.includes("--inspect")) throw new Error("Choose inspect, default dry-run, or --apply");
async function privateFile(path) {
  if (!path) throw new Error("Private explicit configuration path required");
  const info = await stat(path);
  if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error("Private owner-only configuration required");
  return readFile(path, "utf8");
}
const config = privateJson(await privateFile(process.env.AUTH_SUBJECT_ADOPTION_CONFIG));
let dsn; try { dsn = new URL(config.migration_database_url); } catch { throw new Error("Explicit migration credential required"); }
if (!config.database?.startsWith("ink_auth_data_codex_test_") || !Number.isSafeInteger(config.port) || !config.data_directory?.startsWith("/private/tmp/ink-auth-data-") || !["postgres:", "postgresql:"].includes(dsn.protocol) || !dsn.username || decodeURIComponent(dsn.pathname.slice(1)) !== config.database) throw new Error("Named disposable target proof required");
const rawManifest = await privateFile(config.manifest_path);
const manifest = adoptionManifestDto.parse(privateJson(rawManifest));
const manifestHash = createHash("sha256").update(rawManifest).digest("hex");
if (new Set(manifest.entries.map(entry => entry.auth_user_id)).size !== manifest.entries.length) throw new Error("Duplicate target subjects are forbidden");
const client = new pg.Client({ connectionString: config.migration_database_url }); await client.connect();
try {
  const target = (await client.query("SELECT current_database() AS name, current_setting('port')::int AS port, current_setting('data_directory') AS root")).rows[0];
  if (target.name !== config.database || target.port !== config.port || target.root !== config.data_directory) throw new Error("ADOPTION_TARGET_MISMATCH");
  await client.query("BEGIN");
  try {
    const capability = await client.query("SELECT 1 FROM drizzle.schema_capabilities WHERE capability='identity.better-auth.v1' AND version=1 AND contract_sha256=$1", [identityContract.contract_sha256]);
    if (!capability.rows.length) throw new Error("ADOPTION_SCHEMA_NOT_READY");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["identity-subject-adoption-v1"]);
    let created = 0, reused = 0; const inspection = [];
    for (const entry of manifest.entries) {
      if (entry.admin_user_id !== null || entry.expected_admin_sha256 !== null || entry.credential_source === "admin" || entry.common_password_proof !== null) throw new Error("ADOPTION_ADMIN_DOMAIN_SEPARATE");
      const canonical = entry.canonical_user_id === null ? null : (await client.query("SELECT id::text, email, display_name, avatar_url, password_hash, status, created_at::text, updated_at::text FROM public.users WHERE id=$1::bigint FOR UPDATE", [entry.canonical_user_id])).rows[0] ?? null;
      const google = entry.google_account_id === null ? null : (await client.query("SELECT id::text, user_id::text, provider, provider_sub, email, created_at::text, updated_at::text FROM public.oauth_accounts WHERE id=$1::bigint FOR UPDATE", [entry.google_account_id])).rows[0] ?? null;
      if (args.includes("--inspect")) { inspection.push({ entry_index: inspection.length, expected_canonical_sha256: legacySourceFingerprint(canonical), expected_admin_sha256: null, expected_google_sha256: legacySourceFingerprint(google) }); continue; }
      const plan = await planSubjectAdoption(entry, canonical, null, google);
      const authUsers = await client.query('SELECT id, email FROM identity."user" WHERE id=$1 OR email=$2 FOR UPDATE', [plan.authUserId, plan.email]);
      if (authUsers.rows.some(user => user.id !== plan.authUserId || user.email !== plan.email)) throw new Error("ADOPTION_AUTH_IDENTITY_CONFLICT");
      const subject = await client.query("SELECT auth_user_id,canonical_user_id::text FROM identity.subject_links WHERE auth_user_id=$1 OR canonical_user_id=$2::bigint FOR UPDATE", [plan.authUserId, plan.canonicalUserId]);
      if (subject.rows.some(link => link.auth_user_id !== plan.authUserId || link.canonical_user_id !== plan.canonicalUserId)) throw new Error("ADOPTION_CANONICAL_MAPPING_CONFLICT");
      const credentials = await client.query('SELECT "accountId",password FROM identity.account WHERE "userId"=$1 AND "providerId"=\'credential\' FOR UPDATE', [plan.authUserId]);
      if (credentials.rows.some(account => account.accountId !== plan.authUserId || account.password !== plan.passwordHash)) throw new Error("ADOPTION_CREDENTIAL_CONFLICT");
      const googleAccounts = plan.googleAccountId === null ? { rows: [] } : await client.query('SELECT "userId","accountId" FROM identity.account WHERE "providerId"=\'google\' AND ("userId"=$1 OR "accountId"=$2) FOR UPDATE', [plan.authUserId, plan.googleAccountId]);
      if (googleAccounts.rows.some(account => account.userId !== plan.authUserId || account.accountId !== plan.googleAccountId)) throw new Error("ADOPTION_GOOGLE_MAPPING_CONFLICT");
      const complete = authUsers.rows.length && subject.rows.length && (plan.passwordHash === null || credentials.rows.length) && (plan.googleAccountId === null || googleAccounts.rows.length);
      if (complete) { reused++; continue; }
      if (!args.includes("--apply")) { created++; continue; }
      if (!authUsers.rows.length) await client.query('INSERT INTO identity."user" (id,name,email,"emailVerified",image,"createdAt","updatedAt") VALUES ($1,$2,$3,false,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [plan.authUserId, plan.name, plan.email, plan.image]);
      if (!subject.rows.length) await client.query("INSERT INTO identity.subject_links (auth_user_id,canonical_user_id,evidence) VALUES ($1,$2::bigint,$3)", [plan.authUserId, plan.canonicalUserId, `${plan.evidence};manifest-sha256:${manifestHash}`]);
      if (plan.passwordHash !== null && !credentials.rows.length) await client.query('INSERT INTO identity.account (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,\'credential\',$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [randomUUID(), plan.authUserId, plan.passwordHash]);
      if (plan.googleAccountId !== null && !googleAccounts.rows.length) await client.query('INSERT INTO identity.account (id,"accountId","providerId","userId","createdAt","updatedAt") VALUES ($1,$2,\'google\',$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [randomUUID(), plan.googleAccountId, plan.authUserId]);
      await client.query("INSERT INTO public.admin_audit_logs(id,actor_type,action,resource_type,resource_id,request_id,metadata) VALUES($1,'system','auth.subject-adopted','auth_subject',$2,$3,$4::jsonb)", [randomUUID(), plan.authUserId, `adoption_${manifestHash}`, JSON.stringify({ manifest_sha256: manifestHash, canonical_source_sha256: entry.expected_canonical_sha256, google_source_sha256: entry.expected_google_sha256, admin_domain_adopted: false, redacted: true })]);
      created++;
    }
    await client.query(args.includes("--apply") ? "COMMIT" : "ROLLBACK");
    console.log(JSON.stringify({ mode: args.includes("--apply") ? "applied" : args.includes("--inspect") ? "inspect" : "dry-run", database: config.database, manifest_sha256: manifestHash, planned_or_created: created, already_complete: reused, legacy_rows_modified: 0, inspection, redacted: true }));
  } catch { await client.query("ROLLBACK"); throw new Error("Identity adoption failed closed; no database or credential text exposed"); }
} finally { await client.end(); }
