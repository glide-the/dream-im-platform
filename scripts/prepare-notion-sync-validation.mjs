#!/usr/bin/env node
// [Input] Checked-in Admin migrations and a newly created named disposable loopback PostgreSQL cluster.
// [Output] Private restricted-role fixture, migration/ACL/identity-lock receipts and an owned route harness.
// [Pos] Primary-owned migration, fault fixture and lifecycle setup; never reads normal application credentials.
// [Sync] 2026-10-07: primary owns preparation and explicit stdin shutdown before embedded exit hooks.
import { mkdtemp, writeFile, rm, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import pg from "pg";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { buildAuthAccessPolicy } from "../drizzle/data/auth-access-policy-plan.mjs";
if (process.argv.length !== 2) throw Error("Usage: node scripts/prepare-notion-sync-validation.mjs");
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "ink-notion-sync-validation-"));
const suffix = randomBytes(5).toString("hex");
const databaseName = `ink_notion_sync_ownership_test_${suffix}`;
const roles = Object.fromEntries(["auth", "control", "data", "dream"].map(key => [key, `notion_${key}_${suffix}`]));
const passwords = Object.fromEntries(Object.keys(roles).map(key => [key, randomBytes(24).toString("base64url")]));
const privatePath = join(directory, "fixture.json");
let cluster, harness, pool;
const children = new Set();
function run(command, args, env = process.env, successCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" }); children.add(child);
    child.once("error", reject); child.once("exit", code => { children.delete(child); if (successCodes.includes(code)) resolve(code); else reject(Error(`${command} exited ${code}`)); });
  });
}
async function port() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => {
      const address = server.address(); server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
async function cleanup() {
  for (const child of children) child.kill("SIGTERM");
  if (harness && harness.exitCode === null) {
    harness.kill("SIGTERM"); await new Promise(resolve => harness.once("exit", resolve));
  }
  await pool?.end(); await cluster?.stop(); await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ database: databaseName, cleaned: true, normal_services_touched: false }));
}
let stopping = false;
async function stopOwnedValidation() {
  if (stopping) return; stopping = true;
  try { await cleanup(); process.exit(0); } catch { process.exit(1); }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stopOwnedValidation);
// embedded-postgres also registers signal exit hooks. Use this command after "prepared"
// so our private fixture removal completes before process exit hooks run.
process.stdin.setEncoding("utf8");
process.stdin.on("data", input => { if (input.trim() === "stop-owned-validation") void stopOwnedValidation(); });
try {
  const { startEmbeddedPostgres } = await import("../packages/db/dist/embedded-postgres.js");
  cluster = await startEmbeddedPostgres({ mode: "embedded-postgres", dataDir: join(directory, "postgres"),
    port: await port(), user: "postgres", password: randomBytes(24).toString("base64url"), database: databaseName,
    sharedBuffers: "32MB", maxConnections: 36 }, { listenAddresses: "127.0.0.1" });
  pool = new pg.Pool({ connectionString: cluster.connectionString, max: 4 });
  const identity = (await pool.query("SELECT current_database() AS name, current_user AS actor, host(inet_server_addr()) AS address")).rows[0];
  console.log(JSON.stringify({ isolation: identity, owned: true }));
  if (identity.name !== databaseName || identity.actor !== "postgres" || identity.address !== "127.0.0.1") throw Error("Isolation identity mismatch");
  const migrationEnv = { ...process.env, MIGRATION_DATABASE_URL: cluster.connectionString,
    AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"), AI_CREDENTIAL_ENCRYPTION_KEY_ID: `notion-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: randomBytes(32).toString("base64url") };
  // Explicit Admin production migration runner; 0074 is not applied before role-upgrade validation.
  const preDirectory = join(directory, "migrations-through-0073");
  await mkdir(join(preDirectory, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(root, "drizzle/meta/_journal.json"), "utf8"));
  const priorEntries = journal.entries.slice(0, 74);
  if (priorEntries.at(-1).tag !== "0073_majestic_ken_ellis" || journal.entries[74].tag !== "0074_notion_sync_ownership") throw Error("Migration boundary changed");
  await writeFile(join(preDirectory, "meta/_journal.json"), JSON.stringify({ ...journal, entries: priorEntries }));
  for (const entry of priorEntries) await symlink(join(root, "drizzle", `${entry.tag}.sql`), join(preDirectory, `${entry.tag}.sql`));
  await run("node", ["scripts/migrate-provider-managed-accounts.mjs"], { ...migrationEnv, INK_MIGRATIONS_DIR: preDirectory });
  for (const [key, name] of Object.entries(roles)) {
    await pool.query(`CREATE ROLE ${name} ${key === "dream" ? "NOLOGIN" : "LOGIN"} NOINHERIT PASSWORD '${passwords[key]}'`);
  }
  const oldPlan = await buildAuthAccessPolicy(pool, databaseName, roles);
  for (const statement of oldPlan.statements) await pool.query(statement);
  const before = (await pool.query("SELECT to_regprocedure('identity.lock_active_notion_sync_actor(bigint,text)')::text AS fn")).rows[0];
  if (before.fn !== null) throw Error("Pre-capability function unexpectedly present");
  await Promise.all([run("node", ["packages/db/dist/migrate.js"], migrationEnv), run("node", ["packages/db/dist/migrate.js"], migrationEnv)]);
  await run("node", ["scripts/migrate-provider-managed-accounts.mjs"], migrationEnv);
  const installed = (await pool.query("SELECT count(*)::integer AS migrations FROM drizzle.__drizzle_migrations")).rows[0];
  const contract = JSON.parse(await readFile(join(root, "drizzle/contracts/dream-notion-sync-ownership-v1.json"), "utf8"));
  const cap = (await pool.query("SELECT version, contract_sha256 FROM drizzle.schema_capabilities WHERE capability=$1", [contract.capability])).rows[0];
  if (installed.migrations !== 75 || cap?.contract_sha256 !== contract.contract_sha256 || cap.version !== 1) throw Error("Exact migration capability mismatch");
  const functionAccess = (await pool.query("SELECT has_function_privilege($1,'identity.lock_active_notion_sync_actor(bigint,text)','EXECUTE') AS data", [roles.data])).rows[0];
  if (!functionAccess.data) throw Error("Existing DATA role was not upgraded");
  const newPlan = await buildAuthAccessPolicy(pool, databaseName, roles);
  if (!newPlan.statements.some(s => s.includes("GRANT EXECUTE ON FUNCTION identity.lock_active_notion_sync_actor") && s.endsWith(`TO "${roles.data}"`))) throw Error("Fresh DATA ACL plan missing function");
  for (const statement of newPlan.statements) await pool.query(statement);
  await pool.query("INSERT INTO users(id,email,password_hash) VALUES (101,'notion-one@example.invalid','fixture'),(102,'notion-two@example.invalid','fixture'),(103,'notion-lock@example.invalid','fixture')");
  for (const userId of [101,102,103]) {
    await pool.query('INSERT INTO identity."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,now(),now())', [`notion-subject-${userId}`,`notion-subject-${userId}@example.invalid`]);
    await pool.query("INSERT INTO identity.subject_links(auth_user_id,canonical_user_id,evidence) VALUES ($1,$2,'isolated-fixture')",[`notion-subject-${userId}`,userId]);
    await pool.query("INSERT INTO platform_users(id,source,external_user_id,tier,status) VALUES ($1,'ink-dream',$2,'free','active') ON CONFLICT (source,external_user_id) DO NOTHING",[`notion-platform-${userId}`,String(userId)]);
  }
  const restrictedUrl = key => { const url = new URL(cluster.connectionString); url.username=roles[key];url.password=passwords[key];return url.toString(); };
  const data = new pg.Client({ connectionString: restrictedUrl("data") }); await data.connect();
  await data.query("BEGIN");
  if (!(await data.query("SELECT identity.lock_active_notion_sync_actor(103, 'notion-subject-103') AS active")).rows[0].active) throw Error("Active actor lock rejected");
  let disabled = false;
  const deactivate = pool.query("UPDATE users SET status='disabled' WHERE id=103").then(() => { disabled = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  if (disabled) throw Error("Identity disable bypassed SHARE lock");
  await data.query("COMMIT");await deactivate;
  if ((await data.query("SELECT identity.lock_active_notion_sync_actor(103, null) AS active")).rows[0].active) throw Error("Inactive actor lock accepted");
  let denied=false; try { await data.query("UPDATE users SET status='active' WHERE id=103"); } catch(error) { denied=error.code==='42501'; }
  if (!denied) throw Error("DATA identity UPDATE accepted");await data.end();
  const access = (await pool.query("SELECT rolname,has_function_privilege(oid,'identity.lock_active_notion_sync_actor(bigint,text)','EXECUTE') AS execute FROM pg_roles WHERE rolname=ANY($1::text[])", [Object.values(roles)])).rows;
  if (access.some(r=>r.execute !== (r.rolname===roles.data))) throw Error("Actor function ACL expanded to another role");
  console.log(JSON.stringify({ migrations:installed.migrations, exact_capability:cap, concurrent_migrators:true, repeat:true, old_and_fresh_acl:true, actor_disable_blocked:true, data_identity_update_denied:true, function_roles:access }));
  // Primary installs explicit fault injection on its own database only.
  await pool.query(`CREATE FUNCTION public.notion_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_TABLE_NAME='connector_snapshots' THEN
      IF NEW.snapshot_version='fault-snapshot' THEN RAISE EXCEPTION 'OWNED_SNAPSHOT_FAULT'; END IF;
    ELSIF TG_TABLE_NAME='operation_receipts' THEN
      IF NEW.request_id='fault-receipt' THEN RAISE EXCEPTION 'OWNED_RECEIPT_FAULT'; END IF;
    ELSIF TG_TABLE_NAME='admin_audit_logs' THEN
      IF NEW.request_id='fault-audit' THEN RAISE EXCEPTION 'OWNED_AUDIT_FAULT'; END IF;
      IF NEW.request_id='fault-lease-after-audit' THEN PERFORM pg_sleep(4); END IF;
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER notion_snapshot_fault BEFORE INSERT ON connector_snapshots FOR EACH ROW EXECUTE FUNCTION public.notion_test_fault();
  CREATE TRIGGER notion_receipt_fault BEFORE INSERT ON dream.operation_receipts FOR EACH ROW EXECUTE FUNCTION public.notion_test_fault();
  CREATE TRIGGER notion_audit_fault BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public.notion_test_fault();`);
  const {publicKey,privateKey}=await generateKeyPair("ES256",{extractable:true});
  const kid=`notion-key-${suffix}`;
  await pool.query('INSERT INTO identity.jwks(id,"publicKey","privateKey","createdAt",alg,crv) VALUES ($1,$2,$3,now(),\'ES256\',\'P-256\')',[kid,JSON.stringify(await exportJWK(publicKey)),JSON.stringify(await exportJWK(privateKey))]);
  const serverPort=await port();const origin=`http://127.0.0.1:${serverPort}`;const issuer=`${origin}/api/auth`;const resource=`${origin}/dream`;
  const services=["one","two"].map(n=>({id:`notion-service-${n}`,secret:randomBytes(32).toString("hex"),origin,oauthClientId:`notion-oauth-${n}`,redirectUri:`${origin}/callback`,backgroundScopes:["connectors:sync","capabilities:read"]}));
  const sign=(subject,client,scope)=>new SignJWT({client_id:client,scope}).setProtectedHeader({alg:"ES256",kid,typ:"at+jwt"}).setSubject(subject).setJti(randomUUID()).setIssuer(issuer).setAudience(resource).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const tokens={service:await sign(services[0].id,services[0].id,"connectors:sync capabilities:read"),otherService:await sign(services[1].id,services[1].id,"connectors:sync capabilities:read"),limited:await sign(services[0].id,services[0].id,"capabilities:read"),user:await sign("notion-subject-101",services[0].oauthClientId,"dream:read dream:write"),foreignUser:await sign("notion-subject-102",services[0].oauthClientId,"dream:read dream:write")};
  const observerRole=`notion_verify_${suffix}`;const observerPassword=randomBytes(24).toString("base64url");
  await pool.query(`CREATE ROLE ${observerRole} LOGIN NOINHERIT PASSWORD '${observerPassword}'`);
  await pool.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ${observerRole}`);
  await pool.query(`GRANT USAGE ON SCHEMA public,dream TO ${observerRole}`);
  await pool.query(`GRANT SELECT ON resource_connectors,connector_resources,connector_resource_pages,connector_snapshots,dream.operation_receipts,admin_audit_logs TO ${observerRole}`);
  const observer=new URL(cluster.connectionString);observer.username=observerRole;observer.password=observerPassword;
  const legacyId=randomUUID();
  await pool.query("INSERT INTO resource_connectors(id,user_id,name,platform,auth_status,config_json) VALUES ($1,101,'Legacy unresolved','notion','authenticated',$2)",[legacyId,JSON.stringify({snapshot_sync_policy:{schema_version:1,desired:{enabled:true,interval_minutes:15,revision:1},effective:{enabled:true,interval_minutes:15,revision:1},status:"syncing"}})]);
  await pool.query("INSERT INTO connector_resources(id,connector_id,resource_type,external_id,title,metadata_json,sync_status) VALUES ($1,$2,'notion_database','database-A','Database','{}','synced')",[randomUUID(),legacyId]);
  const env={AUTH_DATABASE_URL:restrictedUrl("auth"),DREAM_DATA_DATABASE_URL:restrictedUrl("data"),DREAM_DATA_SERVICE_CLIENTS:JSON.stringify(services),BETTER_AUTH_URL:issuer,BETTER_AUTH_SECRET:randomBytes(32).toString("hex"),AUTH_TRUSTED_ORIGINS:origin,DREAM_API_RESOURCE:resource,GOOGLE_CLIENT_ID:"notion-fixture",GOOGLE_CLIENT_SECRET:"notion-fixture",AUTH_DEVICE_CLIENT_ID:"notion-device",AUTH_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString("hex"),AUTH_RUNTIME_DELEGATION_TTL_SECONDS:"120",AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS:"600",DREAM_DATA_MAX_BODY_BYTES:"1048576",NOTION_SYNC_EXECUTION_POLICY_JSON:JSON.stringify({lease_seconds:3,heartbeat_seconds:1,renewal_budget_seconds:1}),NOTION_SYNC_OWNERSHIP_CLAIMS_ENABLED:"true"};
  await writeFile(privatePath,JSON.stringify({databaseName,roles,env,port:serverPort,tokens,legacyId,observerRole,observerUrl:observer.toString(),adminUrl:cluster.connectionString}),{mode:0o600});
  harness=spawn(process.execPath,["--import","tsx","tests/integration/notionSyncHttpHarness.ts"],{cwd:root,env:{...process.env,NOTION_SYNC_VALIDATION_FIXTURE:privatePath},stdio:"inherit"});
  harness.once("exit",code=>{if(!stopping){ console.error(`Owned harness exited ${code}`);void stopOwnedValidation(); }});
  console.log(JSON.stringify({ prepared:true, private_fixture:privatePath, database:databaseName, technical_only:true }));
} catch(error) { console.error(error.message);await cleanup();process.exit(1); }
