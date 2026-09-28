// [Input] Runner-owned 0068 PostgreSQL, synthetic Admin OAuth service identity and production route DTO.
// [Output] Authenticated Admin task-result claim/replay/settle receipts.
// [Pos] Isolated HTTP-route integration check; no live user account or normal business data.
// [Sync] 2026-09-28: verify claim grant may read only its source Thread Workflow and bound Deck context.
// [Sync] 2026-09-28: remove the retired Dream background-result HTTP probe; current Dream uses in-turn wait_threads.
// [Sync] 2026-09-28: exercise production Admin Route Handler, token verification and claim settlement.
// [Sync] 2026-09-28: a second claim-next scan cannot settle a committed source final while its owner grants remain live.
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { POST } from "../app/api/internal/dream/v1/operations/[operation]/route";
import { closeAuthDatabaseConnections } from "../app/lib/auth/database";
import { runChatThreadOperation, type ChatThreadActor } from "../app/lib/dream/chatThreadService";

const url = process.env.DREAM_DATA_DATABASE_URL;
if (!url || !new URL(url).pathname.slice(1).startsWith("ink_chat_input_queue_test_"))
  throw new Error("Runner-owned queue database required");
const serviceId = `route-service-${randomBytes(5).toString("hex")}`;
const service = {
  id: serviceId, secret: randomBytes(32).toString("hex"), origin: "http://localhost:3000",
  oauthClientId: "route-oauth", redirectUri: "http://localhost:3000/callback",
  backgroundScopes: ["task-return:dispatch", "capabilities:read"],
};
Object.assign(process.env, {
  AUTH_DATABASE_URL: url, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([service]),
  BETTER_AUTH_URL: "http://localhost:3000/api/auth", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  AUTH_TRUSTED_ORIGINS: "http://localhost:3000", DREAM_API_RESOURCE: "http://localhost:8765/api",
  GOOGLE_CLIENT_ID: "route-fixture", GOOGLE_CLIENT_SECRET: "route-fixture",
  AUTH_DEVICE_CLIENT_ID: "route-device",
  AUTH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  AUTH_RUNTIME_DELEGATION_TTL_SECONDS: "120", AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS: "600",
  DREAM_DATA_MAX_BODY_BYTES: "65536", DREAM_GATEWAY_CLIENT_BINDINGS: JSON.stringify([{
    service_client_id: serviceId, gateway_client_id: "gateway-service", oauth_client_ids: ["route-oauth"],
  }]),
});
const pool = new Pool({ connectionString: url });
const database = drizzle(pool);
const actor: ChatThreadActor = { principal: {
  subject: "subject-one", canonical_user_id: "1", client_id: "route-oauth",
  scopes: ["dream:read", "dream:write"], status: "active",
}, threadScope: null };
const run = <T>(operation: Parameters<typeof runChatThreadOperation>[0], input: unknown) =>
  database.transaction(tx => runChatThreadOperation(operation, input, actor, tx)) as Promise<T>;
type RouteBody = {
  data?: {
    claim?: unknown;
    result?: { status: string; revision: number; claim_id: string | null; source_final_message_id: string | null };
    source_session_id?: string;
    source_persistence_authorization?: { token: string };
    source_gateway_authorization?: { token: string };
  };
  error?: { code: string };
};

async function response(operation: string, input: unknown, token: string | null, requestId: string, serviceToken?: string) {
  const request = new Request(`http://localhost:3000/api/internal/dream/v1/operations/${operation}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(serviceToken ? { "x-ink-dream-service-authorization": `Bearer ${serviceToken}` } : {}) },
    body: JSON.stringify({ request_id: requestId, input }),
  });
  const result = await POST(request, { params: Promise.resolve({ operation }) });
  return { status: result.status, body: await result.json() as RouteBody };
}

try {
  if ((await pool.query("SELECT current_database() AS name")).rows[0]?.name !== new URL(url).pathname.slice(1))
    throw new Error("Route probe database identity mismatch");
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  await pool.query(`INSERT INTO identity.jwks (id, "publicKey", "privateKey", "createdAt", alg, crv)
    VALUES ($1, $2, $3, now(), 'ES256', 'P-256')`, [
    "route-fixture-key", JSON.stringify(await exportJWK(publicKey)),
    JSON.stringify(await exportJWK(privateKey)),
  ]);
  const sign = (scope: string) => new SignJWT({ client_id: serviceId, scope })
    .setProtectedHeader({ alg: "ES256", kid: "route-fixture-key", typ: "at+jwt" })
    .setSubject(serviceId).setJti(randomUUID()).setIssuer(process.env.BETTER_AUTH_URL!)
    .setAudience(process.env.DREAM_API_RESOURCE!).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const fullToken = await sign("task-return:dispatch");
  const limitedToken = await sign("capabilities:read");
  const source = (await run<{ thread_id: string }>("chat-thread.create", {
    deck_id: null, voice_id: null, title: "Route source",
  })).thread_id;
  await run("chat-thread.update-session", {
    thread_id: source, claude_session_id: "route-source-sdk-session", agent_contract_version: "route-fixture",
  });
  const task = (await run<{ task: { task_id: string; thread_id: string } }>("task-session.create-returning", {
    source_thread_id: source, request_key: "route-return", title: "Route task",
    initial_message: "Finish route task", source_message_id: null, expected_revision: null,
  })).task;
  await run("chat-message.persist", {
    thread_id: task.thread_id, message_id: "route-target-final", role: "assistant",
    parts: [{ type: "text", text: "Route verified result" }],
    metadata: { turnId: "route-target-turn", turnStatus: "completed", finalPartIndex: 0 },
    history_final_text: "Route verified result", history_process_available: false,
    history_projection_version: 1,
  });
  const notice = (await pool.query(`SELECT id, revision FROM chat_task_result
    WHERE task_id = $1 AND target_turn_id = 'route-target-turn'`, [task.task_id])).rows[0];
  if (!notice) throw new Error("Route fixture did not create a notification");
  const operation = "task-session.result-claim";
  const claimInput = { notification_id: notice.id, expected_revision: notice.revision, source_turn_id: "route-source-turn" };
  const noToken = await response(operation, claimInput, null, "route-missing-token");
  if (noToken.status !== 401 || noToken.body.error?.code !== "DREAM_SERVICE_REQUIRED")
    throw new Error("Unauthenticated route claim was accepted");
  const noScope = await response(operation, claimInput, limitedToken, "route-missing-scope");
  if (noScope.status !== 403 || noScope.body.error?.code !== "DREAM_SERVICE_SCOPE_REQUIRED")
    throw new Error("Service without task-return scope was accepted");
  const claimed = await response(operation, claimInput, fullToken, "route-claim");
  if (claimed.status !== 200 || claimed.body.data?.result?.status !== "dispatching"
    || claimed.body.data?.source_session_id !== "route-source-sdk-session"
    || !claimed.body.data?.source_persistence_authorization?.token
    || !claimed.body.data?.source_gateway_authorization?.token)
    throw new Error(`Authenticated route claim failed: ${claimed.body.error?.code ?? claimed.status}`);
  const sourceGrant = claimed.body.data.source_persistence_authorization.token;
  const sourceContext = await response("workflow-context.resolve", { thread_id: source }, sourceGrant, "route-source-context", fullToken);
  if (sourceContext.status !== 200)
    throw new Error(`Source claim grant cannot read its Workflow context: ${sourceContext.body.error?.code ?? sourceContext.status}`);
  const foreignContext = await response("workflow-context.resolve", { thread_id: task.thread_id }, sourceGrant, "route-foreign-context", fullToken);
  if (foreignContext.status !== 403)
    throw new Error(`Source claim grant read a foreign Thread: ${foreignContext.status}`);
  const replay = await response(operation, claimInput, fullToken, "route-claim");
  if (replay.status !== 200 || replay.body.data?.result?.claim_id !== claimed.body.data.result.claim_id
    || replay.body.data?.source_persistence_authorization?.token !== claimed.body.data.source_persistence_authorization.token)
    throw new Error("Route claim did not recover the same authority");
  await run("chat-message.persist", {
    thread_id: source, message_id: "route-source-final", role: "assistant",
    parts: [{ type: "text", text: "Source handled task result" }],
    metadata: { turnId: "route-source-turn", turnStatus: "completed", finalPartIndex: 0,
      taskResultNotificationId: notice.id },
    history_final_text: "Source handled task result", history_process_available: false,
    history_projection_version: 1,
  });
  // The source result turn has committed, but its Factory owner may still be
  // draining queued user input under these same two grants.
  const concurrentScan = await response("task-session.result-claim-next", {}, fullToken, "route-owner-active-scan");
  if (concurrentScan.status !== 200 || concurrentScan.body.data?.claim !== null)
    throw new Error(`Concurrent claim-next scan failed: ${concurrentScan.body.error?.code ?? concurrentScan.status}`);
  const duringOwner = (await pool.query(`SELECT status, revision FROM chat_task_result WHERE id = $1`, [notice.id])).rows[0];
  if (duringOwner?.status !== "dispatching" || duringOwner.revision !== claimed.body.data.result.revision)
    throw new Error("Concurrent scan settled a result while the source owner grants were active");
  const activeContext = await response("workflow-context.resolve", { thread_id: source }, sourceGrant,
    "route-source-context-after-final", fullToken);
  if (activeContext.status !== 200)
    throw new Error(`Committed source final prematurely revoked the owner grant: ${activeContext.body.error?.code ?? activeContext.status}`);
  const settled = await response("task-session.result-settle", {
    notification_id: notice.id, expected_revision: claimed.body.data.result.revision,
    claim_id: claimed.body.data.result.claim_id, action: "delivered",
  }, fullToken, "route-settle");
  if (settled.status !== 200 || settled.body.data?.result?.status !== "delivered"
    || settled.body.data.result.source_final_message_id !== "route-source-final")
    throw new Error(`Authenticated route settlement failed: ${settled.body.error?.code ?? settled.status}`);
  const afterTerminal = await response(operation, claimInput, fullToken, "route-claim");
  if (afterTerminal.status !== 409 || afterTerminal.body.error?.code !== "TASK_SESSION_RESULT_REVISION_CONFLICT")
    throw new Error(`Terminal route claim receipt differed: ${afterTerminal.status}/${afterTerminal.body.error?.code ?? "success"}`);
  process.stdout.write(JSON.stringify({ status: "passed", route: true, auth: true, scope_denial: true,
    claim_recovery: true, owner_grant_preserved: true, delivered: true, terminal_replay_denied: true }) + "\n");
} finally {
  await closeAuthDatabaseConnections();
  const dataPool = (globalThis as typeof globalThis & { __ink_dream_data_pool?: Pool }).__ink_dream_data_pool;
  if (dataPool) await dataPool.end();
  await pool.end();
}
