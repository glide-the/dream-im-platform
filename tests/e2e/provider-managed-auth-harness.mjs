// [Input] Ephemeral TLS key/certificate paths and the expected built-in GitHub OAuth client id.
// [Output] Loopback-only HTTPS product fake validating managed auth, account catalogs, routing, failure/retry, and strict official-host CONNECT policy.
// [Pos] Managed-auth E2E transport harness; it never intercepts Admin/Gateway routes or logs credential values.
// [Sync] 2026-09-04: add bounded Codex/xAI/Copilot model endpoints and fail the first account-one Copilot catalog request.

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { createServer as createProxyServer } from "node:http";

const OFFICIAL_HOSTS = new Set([
  "chatgpt.com",
  "api.x.ai",
  "github.com",
  "api.github.com",
  "api.githubcopilot.com",
  "managed-auth-proxy-probe.invalid",
]);

const MAX_REQUEST_BYTES = 128 * 1024;
const EXPECTED_COPILOT_HEADERS = {
  "user-agent": "GitHubCopilotChat/0.38.2",
  "editor-version": "vscode/1.110.1",
  "editor-plugin-version": "copilot-chat/0.38.2",
  "copilot-integration-id": "vscode-chat",
  "x-github-api-version": "2025-10-01",
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Managed-auth harness did not receive a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function json(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      value += String(chunk);
      if (Buffer.byteLength(value) > MAX_REQUEST_BYTES) {
        reject(new Error("Fake upstream request exceeded the size limit"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(value));
    request.on("error", reject);
  });
}

function bearer(request) {
  const value = String(request.headers.authorization ?? "");
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : "";
}

const DEVICE_GRANT_ACCOUNT_SEQUENCE = [1, 2, 2, 1];

const CODEX_MODELS = [{
  slug: "codex-discovered-e2e",
  display_name: "Codex Discovered E2E",
  visibility: "list",
  supported_in_api: true,
  context_window: 128_000,
}];

const XAI_MODELS = [{
  id: "grok-discovered-e2e",
  owned_by: "xai",
  input_modalities: ["text"],
  output_modalities: ["text"],
}];

function copilotModels(account) {
  return [
    {
      id: `copilot-discovered-${account.key}`,
      name: `Copilot Discovered ${account.key}`,
      vendor: "anthropic",
      model_picker_enabled: true,
      capabilities: {
        type: "chat",
        limits: { max_prompt_tokens: 64_000, max_output_tokens: 4_096 },
      },
    },
    {
      id: `copilot-responses-unsupported-${account.key}`,
      name: `Copilot Responses Unsupported ${account.key}`,
      vendor: "openai",
      model_picker_enabled: true,
      capabilities: {
        type: "chat",
        limits: { max_prompt_tokens: 64_000, max_output_tokens: 4_096 },
      },
    },
    {
      id: `copilot-hidden-${account.key}`,
      name: `Copilot Hidden ${account.key}`,
      vendor: "anthropic",
      model_picker_enabled: false,
      capabilities: { type: "chat" },
    },
  ];
}

function accountGrantFixture(grantIndex, accountIndex) {
  const suffix = randomBytes(18).toString("base64url");
  return {
    key: `account-${accountIndex}`,
    numericId: 90_000 + accountIndex,
    login: `managed-auth-e2e-${accountIndex}`,
    userCode: `INK-${String(grantIndex).padStart(4, "0")}`,
    deviceCode: `device_${suffix}`,
    sourceToken: `source_${suffix}`,
    copilotToken: `copilot_${suffix}`,
    pollCount: 0,
    identityCount: 0,
    copilotExchangeCount: 0,
  };
}

function safeRequestName(request) {
  const host = String(request.headers.host ?? "").split(":")[0].toLowerCase();
  const pathname = new URL(request.url ?? "/", "https://fake.invalid").pathname;
  return `${request.method ?? "UNKNOWN"} ${host}${pathname}`;
}

export async function startProviderManagedAuthHarness({ certPath, keyPath, clientId }) {
  const state = {
    accounts: [],
    grants: [],
    calls: [],
    deniedConnects: [],
    errors: [],
    resourceCalls: [],
    modelCalls: [],
    catalogFailuresRemaining: new Map([["account-1", 1]]),
  };
  const sockets = new Set();

  const fakeServer = createHttpsServer(
    { cert: await readFile(certPath), key: await readFile(keyPath) },
    async (request, response) => {
      const requestName = safeRequestName(request);
      state.calls.push(requestName);
      try {
        const host = String(request.headers.host ?? "").split(":")[0].toLowerCase();
        const url = new URL(request.url ?? "/", "https://fake.invalid");

        if (
          host === "managed-auth-proxy-probe.invalid"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/proxy-probe"
        ) {
          response.writeHead(204, { "cache-control": "no-store" });
          response.end();
          return;
        }

        if (
          host === "github.com"
          && request.method === "POST"
          && url.pathname === "/__ink_e2e__/login/device/code"
        ) {
          const form = new URLSearchParams(await requestBody(request));
          if (form.get("client_id") !== clientId || form.get("scope") !== "read:user") {
            throw new Error("Device start did not use the configured client and scope");
          }
          const grantIndex = state.grants.length + 1;
          const accountIndex = DEVICE_GRANT_ACCOUNT_SEQUENCE[grantIndex - 1] ?? grantIndex;
          const account = accountGrantFixture(grantIndex, accountIndex);
          state.grants.push(account);
          if (!state.accounts.some((candidate) => candidate.key === account.key)) {
            state.accounts.push(account);
          }
          json(response, 200, {
            device_code: account.deviceCode,
            user_code: account.userCode,
            verification_uri: "https://github.com/__ink_e2e__/login/device",
            verification_uri_complete: `https://github.com/__ink_e2e__/login/device?user_code=${encodeURIComponent(account.userCode)}`,
            expires_in: 600,
            interval: 1,
          });
          return;
        }

        if (
          host === "github.com"
          && request.method === "POST"
          && url.pathname === "/__ink_e2e__/login/oauth/access_token"
        ) {
          const form = new URLSearchParams(await requestBody(request));
          const account = state.grants.find((candidate) => candidate.deviceCode === form.get("device_code"));
          if (
            !account
            || form.get("client_id") !== clientId
            || form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code"
          ) {
            throw new Error("Device poll contract was invalid");
          }
          account.pollCount += 1;
          if (account.pollCount === 1) {
            json(response, 200, { error: "authorization_pending" });
            return;
          }
          json(response, 200, {
            access_token: account.sourceToken,
            token_type: "bearer",
            scope: "read:user",
            expires_in: 3600,
          });
          return;
        }

        if (
          host === "api.github.com"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/user"
        ) {
          const account = state.grants.find((candidate) => candidate.sourceToken === bearer(request));
          if (!account) throw new Error("GitHub identity request did not use an issued source token");
          account.identityCount += 1;
          json(response, 200, { id: account.numericId, login: account.login });
          return;
        }

        if (
          host === "api.github.com"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/copilot_internal/v2/token"
        ) {
          const account = state.grants.find((candidate) => candidate.sourceToken === bearer(request));
          if (!account) throw new Error("Copilot exchange did not use an issued source token");
          for (const [header, expected] of Object.entries(EXPECTED_COPILOT_HEADERS)) {
            if (request.headers[header] !== expected) {
              throw new Error(`Copilot exchange did not use the built-in ${header}`);
            }
          }
          account.copilotExchangeCount += 1;
          json(response, 200, {
            token: account.copilotToken,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          });
          return;
        }

        if (
          host === "chatgpt.com"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/backend-api/codex/models"
        ) {
          if (!bearer(request) || !request.headers["chatgpt-account-id"]) {
            throw new Error("Codex catalog request did not use its managed account headers");
          }
          state.modelCalls.push({ product: "codex", accountKey: "fixture" });
          json(response, 200, { models: CODEX_MODELS });
          return;
        }

        if (
          host === "api.x.ai"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/v1/models"
        ) {
          if (!bearer(request)) {
            throw new Error("xAI catalog request did not use its managed bearer token");
          }
          state.modelCalls.push({ product: "xai", accountKey: "fixture" });
          json(response, 200, { data: XAI_MODELS });
          return;
        }

        if (
          host === "api.githubcopilot.com"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/models"
        ) {
          const account = state.grants.find((candidate) => candidate.copilotToken === bearer(request));
          if (!account) throw new Error("Copilot catalog request did not use an issued short token");
          for (const [header, expected] of Object.entries(EXPECTED_COPILOT_HEADERS)) {
            if (request.headers[header] !== expected) {
              throw new Error(`Copilot catalog request did not use the built-in ${header}`);
            }
          }
          const attempt = state.modelCalls.filter((call) =>
            call.product === "github_copilot" && call.accountKey === account.key
          ).length + 1;
          state.modelCalls.push({ product: "github_copilot", accountKey: account.key, attempt });
          const failuresRemaining = state.catalogFailuresRemaining.get(account.key) ?? 0;
          if (failuresRemaining > 0) {
            state.catalogFailuresRemaining.set(account.key, failuresRemaining - 1);
            json(response, 503, { error: "catalog_temporarily_unavailable" });
            return;
          }
          json(response, 200, { data: copilotModels(account) });
          return;
        }

        if (
          host === "api.githubcopilot.com"
          && request.method === "POST"
          && url.pathname === "/__ink_e2e__/chat/completions"
        ) {
          const account = state.grants.find((candidate) => candidate.copilotToken === bearer(request));
          if (!account) throw new Error("Copilot resource request did not use an issued short token");
          for (const [header, expected] of Object.entries(EXPECTED_COPILOT_HEADERS)) {
            if (request.headers[header] !== expected) {
              throw new Error(`Copilot resource request did not use the built-in ${header}`);
            }
          }
          const raw = await requestBody(request);
          let body;
          try {
            body = JSON.parse(raw || "{}");
          } catch {
            throw new Error("Copilot resource request body was not JSON");
          }
          state.resourceCalls.push({
            accountKey: account.key,
            model: typeof body.model === "string" ? body.model : null,
            stream: body.stream === true,
          });
          json(response, 200, {
            id: `chatcmpl_${account.key}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: typeof body.model === "string" ? body.model : "copilot-e2e",
            choices: [{
              index: 0,
              message: { role: "assistant", content: `response from ${account.login}` },
              finish_reason: "stop",
              logprobs: null,
            }],
            usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
          });
          return;
        }

        if (
          host === "github.com"
          && request.method === "GET"
          && url.pathname === "/__ink_e2e__/login/device"
        ) {
          response.writeHead(200, { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" });
          response.end("<!doctype html><title>Fake GitHub Device Verification</title><p>Authorization is simulated by the next poll.</p>");
          return;
        }

        state.errors.push(`Unexpected fake upstream request: ${requestName}`);
        request.resume();
        json(response, 404, { error: "unexpected_fake_upstream_request" });
      } catch (error) {
        state.errors.push(error instanceof Error ? error.message : "Unknown fake upstream failure");
        if (!response.headersSent) json(response, 400, { error: "fake_upstream_contract_failed" });
        else response.destroy();
      }
    },
  );
  fakeServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const fakePort = await listen(fakeServer);

  const proxyServer = createProxyServer((_request, response) => {
    response.writeHead(405, { connection: "close" });
    response.end();
  });
  proxyServer.on("connect", (request, clientSocket, head) => {
    const authority = String(request.url ?? "");
    const separator = authority.lastIndexOf(":");
    const host = separator > 0 ? authority.slice(0, separator).toLowerCase() : "";
    const port = separator > 0 ? Number(authority.slice(separator + 1)) : NaN;
    if (!OFFICIAL_HOSTS.has(host) || port !== 443) {
      state.deniedConnects.push(
        `${host || "missing-host"}:${Number.isFinite(port) ? port : "invalid-port"}`,
      );
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstreamSocket = connect(fakePort, "127.0.0.1");
    sockets.add(clientSocket);
    sockets.add(upstreamSocket);
    clientSocket.once("close", () => sockets.delete(clientSocket));
    upstreamSocket.once("close", () => sockets.delete(upstreamSocket));
    upstreamSocket.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: ink-managed-auth-e2e\r\n\r\n");
      if (head.length > 0) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });
    upstreamSocket.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstreamSocket.destroy());
  });
  const proxyPort = await listen(proxyServer);

  return {
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    probeUrl: "https://managed-auth-proxy-probe.invalid/__ink_e2e__/proxy-probe",
    state,
    secretSentinels() {
      return state.grants.flatMap((grant) => [
        grant.deviceCode,
        grant.sourceToken,
        grant.copilotToken,
      ]);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([closeServer(proxyServer), closeServer(fakeServer)]);
    },
  };
}
