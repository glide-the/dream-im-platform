#!/usr/bin/env node
// [Input] AutoDL runtime auth/resource/service-client configuration and the local Admin listener.
// [Output] Redacted proof that client_credentials and the protected Dream capability route work.
// [Pos] Post-release authentication/data boundary gate; never writes schema or product data.
// [Sync] 2026-09-17: verify the deployed limited auth role and provisioned confidential client.

function fail(code) { throw new Error(code); }

function required(name) {
  const value = process.env[name];
  if (!value) fail("AUTODL_AUTH_CONFIGURATION_MISSING");
  return value;
}

function formComponent(value) {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

async function responseJson(response, code) {
  if (!response.ok) fail(code);
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) fail(code);
  try { return JSON.parse(text); } catch { fail(code); }
}

async function run() {
  const port = required("PORT");
  if (!/^[1-9][0-9]*$/.test(port)) fail("AUTODL_AUTH_CONFIGURATION_INVALID");
  let clients;
  try { clients = JSON.parse(required("DREAM_DATA_SERVICE_CLIENTS")); }
  catch { fail("AUTODL_AUTH_CONFIGURATION_INVALID"); }
  const client = Array.isArray(clients)
    ? clients.find(candidate => candidate?.backgroundScopes?.includes("capabilities:read"))
    : null;
  if (!client || typeof client.id !== "string" || typeof client.secret !== "string"
    || typeof client.origin !== "string") fail("AUTODL_AUTH_CONFIGURATION_INVALID");
  const base = `http://127.0.0.1:${port}`;
  const basic = Buffer.from(`${formComponent(client.id)}:${formComponent(client.secret)}`, "utf8").toString("base64");
  const tokenResponse = await fetch(`${base}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { accept: "application/json", authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", resource: required("DREAM_API_RESOURCE") }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const token = await responseJson(tokenResponse, "AUTODL_SERVICE_TOKEN_FAILED");
  if (token?.token_type !== "Bearer" || typeof token.access_token !== "string"
    || !/^[A-Za-z0-9._~-]+$/.test(token.access_token)) fail("AUTODL_SERVICE_TOKEN_INVALID");
  const capabilityResponse = await fetch(`${base}/api/internal/dream/v1/capabilities`, {
    headers: { accept: "application/json", authorization: `Bearer ${token.access_token}`, origin: client.origin,
      "x-request-id": "admin-autodl-release-verification" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  await responseJson(capabilityResponse, "AUTODL_CAPABILITY_AUTH_FAILED");
  console.log(JSON.stringify({ service_token: tokenResponse.status, capabilities: capabilityResponse.status, redacted: true }));
}

run().catch(error => {
  console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message : "AUTODL_AUTH_VERIFICATION_FAILED");
  process.exitCode = 1;
});
