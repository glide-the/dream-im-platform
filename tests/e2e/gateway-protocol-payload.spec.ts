import { expect, test, type Page } from "@playwright/test";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : undefined;
const databaseName = parsedDatabaseUrl?.pathname.slice(1) ?? "";
const isolated = databaseName === "ink-memory" && parsedDatabaseUrl?.port === "55433";
let upstream: Server | undefined;
let upstreamUrl = "";
let observedClaudeCodeSystemRole = false;
let observedClaudeCodeBeta = false;

function diagnostics(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`requestfailed: ${request.url()}`); });
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`http ${response.status()}: ${response.url()}`); });
  return errors;
}

function anthropicStream(response: import("node:http").ServerResponse) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": "provider-anthropic-stream" });
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_mock","type":"message","role":"assistant","model":"claude-mock","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":9,"output_tokens":0,"cache_read_input_tokens":2}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello from anthropic"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  response.write(frames[0].slice(0, 47));
  setTimeout(() => { response.write(frames[0].slice(47) + frames[1] + frames[2].slice(0, 61)); setTimeout(() => response.end(frames[2].slice(61) + frames.slice(3).join("")), 10); }, 10);
}

function openAIStream(response: import("node:http").ServerResponse) {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-request-id": "provider-openai-stream" });
  const frames = [
    'data: {"id":"chatcmpl_mock","object":"chat.completion.chunk","created":1,"model":"gpt-mock","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
    'data: {"id":"chatcmpl_mock","object":"chat.completion.chunk","created":1,"model":"gpt-mock","choices":[{"index":0,"delta":{"content":"hello from openai"},"finish_reason":null}]}\n\n',
    'data: {"id":"chatcmpl_mock","object":"chat.completion.chunk","created":1,"model":"gpt-mock","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"id":"chatcmpl_mock","object":"chat.completion.chunk","created":1,"model":"gpt-mock","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":5,"total_tokens":16,"prompt_tokens_details":{"cached_tokens":3}}}\n\n',
    'data: [DONE]\n\n',
  ];
  response.write(frames[0] + frames[1].slice(0, 33));
  setTimeout(() => response.end(frames[1].slice(33) + frames.slice(2).join("")), 10);
}

test.describe("Gateway protocol, payload and responsive request detail", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!bootstrapToken || !databaseUrl || !isolated, "Requires the explicit disposable PostgreSQL lane on 127.0.0.1:55433/ink-memory");

  test.beforeAll(async () => {
    upstream = createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { raw += String(chunk); });
      request.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const pathname = new URL(request.url ?? "/", "http://mock-provider.local").pathname;
        if (pathname === "/v1/messages") {
          observedClaudeCodeSystemRole ||= Array.isArray(body.messages) && body.messages.some((message: { role?: string }) => message?.role === "system");
          observedClaudeCodeBeta ||= String(request.headers["anthropic-beta"] ?? "").includes("claude-code");
          if (body.stream) return anthropicStream(response);
          response.writeHead(200, { "content-type": "application/json", "request-id": "provider-anthropic-json" });
          response.end(JSON.stringify({ id: "msg_json", type: "message", role: "assistant", model: "claude-mock", content: [{ type: "text", text: "anthropic json" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 8, output_tokens: 3, cache_read_input_tokens: 1 } }));
          return;
        }
        if (pathname === "/v1/chat/completions") {
          if (body.stream) return openAIStream(response);
          response.writeHead(200, { "content-type": "application/json", "x-request-id": "provider-openai-json" });
          response.end(JSON.stringify({ id: "chat_json", object: "chat.completion", created: 1, model: "gpt-mock", choices: [{ index: 0, message: { role: "assistant", content: "openai json" }, finish_reason: "stop", logprobs: null }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 2 } } }));
          return;
        }
        response.writeHead(404, { "content-type": "application/json" });
        response.end('{"error":{"message":"not found"}}');
      });
    });
    await new Promise<void>((resolve, reject) => { upstream!.once("error", reject); upstream!.listen(0, "127.0.0.1", resolve); });
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    if (upstream) await new Promise<void>((resolve, reject) => upstream!.close((error) => error ? reject(error) : resolve()));
  });

  test("official SDKs consume native/cross streams and full payload access is audited", async ({ page, context, baseURL }, testInfo) => {
    const browserErrors = diagnostics(page);
    await context.route("http://unpkg.com/react-grab/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }));
    const origin = new URL(baseURL!).origin;
    await page.goto("/admin");
    await page.getByLabel("显示名称").fill("Gateway E2E Admin");
    await page.getByLabel("管理员邮箱").fill("gateway-admin@example.test");
    await page.getByLabel("初始密码").fill("Gateway-admin-2026!");
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    const bootstrapResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/auth/bootstrap") && response.request().method() === "POST");
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    expect((await bootstrapResponsePromise).status()).toBe(201);
    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "ink_admin_session");
    if (sessionCookie?.secure && origin.startsWith("http://")) {
      await context.clearCookies({ name: "ink_admin_session" });
      await context.addCookies([{ name: sessionCookie.name, value: sessionCookie.value, url: origin, httpOnly: true, secure: false, sameSite: "Lax", expires: sessionCookie.expires }]);
      await page.goto("/admin");
    }
    await expect(page).toHaveURL(/\/admin$/);
    browserErrors.length = 0;

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(`INSERT INTO users (id, email, password_hash, display_name, role) VALUES (201, 'gateway-user@example.test', 'fixture-password-hash-not-a-credential', 'Gateway User', 'user')`);
    const provisionedGatewayUser = (await pool.query(`SELECT id, daily_token_limit, monthly_token_limit FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '201'`)).rows[0];
    const gatewayUserId = String(provisionedGatewayUser?.id);
    expect(gatewayUserId).not.toBe("undefined");
    expect(Number(provisionedGatewayUser?.daily_token_limit)).toBe(100_000);
    expect(provisionedGatewayUser?.monthly_token_limit).toBeNull();
    await pool.query(`UPDATE billing_accounts SET available_microusd = 1000000000 WHERE platform_user_id = $1`, [gatewayUserId]);

    const api = context.request;
    const adminHeaders = { origin, "content-type": "application/json" };
    async function provider(code: string, protocol: "anthropic" | "openai") {
      const response = await api.post(`${baseURL}/api/admin/providers`, { headers: adminHeaders, data: { code, name: code, protocol, baseUrl: upstreamUrl, apiKey: `provider-${code}-secret`, status: "active", timeoutMs: 5000, maxRetries: 0, config: protocol === "anthropic" ? { authMode: "x-api-key" } : {} } });
      expect(response.status()).toBe(201);
      return (await response.json()).data.id as string;
    }
    async function model(providerId: string, code: string, upstreamModel: string) {
      const response = await api.post(`${baseURL}/api/admin/models`, { headers: adminHeaders, data: { providerId, code, upstreamModel, displayName: code, contextWindow: 128000, maxOutputTokens: 4096, capabilities: { chat: true, tools: true, thinking: true }, enabled: true } });
      expect(response.status()).toBe(201);
      const modelId = (await response.json()).data.id as string;
      const pricing = await api.post(`${baseURL}/api/admin/pricing-rules`, { headers: adminHeaders, data: { modelId, userTier: "free", inputPriceMicrousdPerMillion: 1000, outputPriceMicrousdPerMillion: 2000, cacheReadPriceMicrousdPerMillion: 100, cacheWritePriceMicrousdPerMillion: 200, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date(Date.now() - 60_000).toISOString() } });
      expect(pricing.status()).toBe(201);
    }
    const anthropicProvider = await provider("gateway-anthropic-e2e", "anthropic");
    const openAIProvider = await provider("gateway-openai-e2e", "openai");
    await model(anthropicProvider, "anthropic-native-e2e", "claude-mock");
    await model(openAIProvider, "openai-native-e2e", "gpt-mock");

    const keyResponse = await api.post(`${baseURL}/api/admin/gateway-api-keys`, { headers: adminHeaders, data: { platformUserId: gatewayUserId, name: "gateway-contract-e2e", scopes: ["messages:create", "chat:create", "models:list"], expiresAt: null } });
    expect(keyResponse.status()).toBe(201);
    const gatewayKey = (await keyResponse.json()).data.plaintextKey as string;

    // A policy rejection is still a complete application-layer exchange. It
    // must preserve the request and protocol-correct response instead of
    // leaving an uninspectable gateway_requests row in `pending` capture state.
    await pool.query(`INSERT INTO users (id, email, password_hash, display_name, role) VALUES (202, 'gateway-limited@example.test', 'fixture-password-hash-not-a-credential', 'Gateway Limited User', 'user')`);
    const limitedGatewayUserId = String((await pool.query(`SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '202'`)).rows[0]?.id);
    expect(limitedGatewayUserId).not.toBe("undefined");
    await pool.query(`UPDATE platform_users SET daily_token_limit = 1 WHERE id = $1`, [limitedGatewayUserId]);
    await pool.query(`UPDATE billing_accounts SET available_microusd = 1000000000 WHERE platform_user_id = $1`, [limitedGatewayUserId]);
    const limitedKeyResponse = await api.post(`${baseURL}/api/admin/gateway-api-keys`, { headers: adminHeaders, data: { platformUserId: limitedGatewayUserId, name: "gateway-limited-e2e", scopes: ["messages:create"], expiresAt: null } });
    expect(limitedKeyResponse.status()).toBe(201);
    const limitedGatewayKey = (await limitedKeyResponse.json()).data.plaintextKey as string;
    const rejectedRawBody = JSON.stringify({ model: "anthropic-native-e2e", max_tokens: 32, stream: true, messages: [{ role: "user", content: "policy-rejection-payload-marker" }] });
    const rejectedResponse = await fetch(`${baseURL}/v1/messages?beta=true`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": limitedGatewayKey }, body: rejectedRawBody });
    expect(rejectedResponse.status).toBe(429);
    expect(rejectedResponse.headers.get("content-type")).toContain("application/json");
    const rejectedRequestId = rejectedResponse.headers.get("x-request-id")!;
    const rejectedBody = await rejectedResponse.json();
    expect(rejectedBody).toMatchObject({ type: "error", request_id: rejectedRequestId, error: { type: "rate_limit_error", code: "DAILY_TOKEN_LIMIT_EXCEEDED", request_id: rejectedRequestId, limit: 1, current: 0, remaining: 1, limit_window: "day", limit_metric: "tokens" } });
    expect(rejectedBody.error.requested).toBeGreaterThan(1);
    expect(rejectedBody.error.exceeded_by).toBe(rejectedBody.error.requested - 1);
    const rejectedCapture = await pool.query(`SELECT r.payload_capture_status, r.error_message, r.response_summary, q.headers, q.body_text AS request_body, p.body_text AS response_body, p.http_status, p.completion_status FROM gateway_requests r JOIN gateway_request_payloads q ON q.gateway_request_id = r.id JOIN gateway_response_payloads p ON p.gateway_request_id = r.id WHERE r.id = $1`, [rejectedRequestId]);
    expect(rejectedCapture.rows[0]).toMatchObject({ payload_capture_status: "complete", request_body: rejectedRawBody, http_status: 429, completion_status: "complete" });
    expect(rejectedCapture.rows[0].error_message).toContain("Daily token limit exceeded: current=0");
    expect(rejectedCapture.rows[0].response_summary).toMatchObject({ rejection_stage: "preauthorization", limit_window: "day", limit_metric: "tokens", current: 0, limit: 1, remaining: 1 });
    expect(rejectedCapture.rows[0].headers["x-api-key"]).toBe("[REDACTED]");
    expect(rejectedCapture.rows[0].response_body).toContain("DAILY_TOKEN_LIMIT_EXCEEDED");
    expect(JSON.stringify(rejectedCapture.rows[0])).not.toContain(limitedGatewayKey);

    const anthropicJson = await fetch(`${baseURL}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": gatewayKey }, body: JSON.stringify({ model: "anthropic-native-e2e", max_tokens: 32, messages: [{ role: "user", content: "anthropic non-stream contract" }] }) });
    expect(anthropicJson.status).toBe(200);
    expect(await anthropicJson.json()).toMatchObject({ type: "message", content: [{ type: "text", text: "anthropic json" }] });
    const openAIJson = await fetch(`${baseURL}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${gatewayKey}` }, body: JSON.stringify({ model: "openai-native-e2e", messages: [{ role: "user", content: "openai non-stream contract" }] }) });
    expect(openAIJson.status).toBe(200);
    expect(await openAIJson.json()).toMatchObject({ object: "chat.completion", choices: [{ message: { content: "openai json" } }] });

    const nativeFetch = await fetch(`${baseURL}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": gatewayKey, authorization: `Bearer ${gatewayKey}` }, body: JSON.stringify({ model: "anthropic-native-e2e", max_tokens: 64, stream: true, messages: [{ role: "user", content: "payload-marker-完整报文" }] }) });
    expect(nativeFetch.status).toBe(200);
    const requestId = nativeFetch.headers.get("x-request-id")!;
    const reader = nativeFetch.body!.getReader();
    const decoder = new TextDecoder();
    let rawSse = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; rawSse += decoder.decode(value, { stream: true }); }
    expect(rawSse).toContain("event: message_start");
    expect(rawSse).toContain("event: message_stop");

    const curl = await execFileAsync("curl", [
      "--silent", "--show-error", "--fail-with-body", "-N",
      "-H", "content-type: application/json",
      "-H", `x-api-key: ${gatewayKey}`,
      "--data", JSON.stringify({ model: "anthropic-native-e2e", max_tokens: 32, stream: true, messages: [{ role: "user", content: "curl streaming smoke" }] }),
      `${baseURL}/v1/messages`,
    ], { maxBuffer: 1_000_000 });
    expect(curl.stdout).toContain("event: content_block_delta");
    expect(curl.stdout).toContain("event: message_stop");

    const claudeCliPath = process.env.CLAUDE_CLI_PATH;
    if (claudeCliPath) {
      const cliConfig = testInfo.outputPath("claude-cli-config");
      const cliCwd = testInfo.outputPath("claude-cli-cwd");
      await mkdir(cliConfig, { recursive: true });
      await mkdir(cliCwd, { recursive: true });
      const cli = await execFileAsync(claudeCliPath, [
        "-p", "Return the word ok.",
        "--model", "anthropic-native-e2e",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
      ], {
        cwd: cliCwd,
        timeout: 30_000,
        maxBuffer: 2_000_000,
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: baseURL!,
          ANTHROPIC_AUTH_TOKEN: gatewayKey,
          CLAUDE_CONFIG_DIR: cliConfig,
        },
      });
      expect(cli.stdout).toContain("hello from anthropic");
      expect(observedClaudeCodeSystemRole).toBe(true);
      expect(observedClaudeCodeBeta).toBe(true);
    }

    const anthropic = new Anthropic({ apiKey: gatewayKey, baseURL: baseURL! });
    let anthropicText = "";
    const anthropicSdkStream = anthropic.messages.stream({ model: "openai-native-e2e", max_tokens: 64, messages: [{ role: "user", content: "cross anthropic sdk" }] });
    for await (const event of anthropicSdkStream) if (event.type === "content_block_delta" && event.delta.type === "text_delta") anthropicText += event.delta.text;
    expect(anthropicText).toContain("hello from openai");

    const openai = new OpenAI({ apiKey: gatewayKey, baseURL: `${baseURL}/v1` });
    let openAIText = "";
    const openAISdkStream = await openai.chat.completions.create({ model: "anthropic-native-e2e", messages: [{ role: "user", content: "cross openai sdk" }], stream: true, stream_options: { include_usage: true } });
    for await (const chunk of openAISdkStream) openAIText += chunk.choices[0]?.delta.content ?? "";
    expect(openAIText).toContain("hello from anthropic");

    const persisted = await pool.query(`SELECT r.payload_capture_status, q.headers, q.body_text, p.completion_status, p.provider_request_id, p.sha256, string_agg(e.raw_event, '' ORDER BY e.sequence) AS raw_sse, array_agg(e.sequence ORDER BY e.sequence) AS sequences FROM gateway_requests r JOIN gateway_request_payloads q ON q.gateway_request_id = r.id JOIN gateway_response_payloads p ON p.gateway_request_id = r.id JOIN gateway_response_events e ON e.gateway_request_id = r.id WHERE r.id = $1 GROUP BY r.payload_capture_status, q.headers, q.body_text, p.completion_status, p.provider_request_id, p.sha256`, [requestId]);
    expect(persisted.rows[0]).toMatchObject({ payload_capture_status: "complete", completion_status: "complete" });
    expect(persisted.rows[0].body_text).toContain("payload-marker-完整报文");
    expect(persisted.rows[0].headers.authorization).toBe("[REDACTED]");
    expect(persisted.rows[0].headers["x-api-key"]).toBe("[REDACTED]");
    expect(persisted.rows[0].raw_sse).toBe(rawSse);
    expect(persisted.rows[0].sequences).toEqual([0, 1, 2, 3, 4, 5]);
    expect(persisted.rows[0].provider_request_id).toBe("provider-anthropic-stream");
    expect(persisted.rows[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/gateway/requests");
    await expect(page.getByText("DAILY_TOKEN_LIMIT_EXCEEDED", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `查看 ${rejectedRequestId} 详情` }).click();
    await expect(page.getByTestId("gateway-rate-limit-reason")).toContainText("每日 Token 上限已超出");
    await expect(page.getByTestId("gateway-rate-limit-reason")).toContainText("请求前剩余");
    await expect(page.getByTestId("gateway-rate-limit-reason")).toContainText("Provider 调用前");
    await expect(page.getByTestId("gateway-rate-limit-reason")).toContainText("实时用量窗口是只读计数");
    const policyLink = page.getByTestId("gateway-rate-limit-config-link");
    await expect(policyLink).toHaveText("配置此用户的默认 Token 上限");
    await expect(policyLink).toHaveAttribute("href", "/admin/gateway/rate-limits?email=gateway-limited%40example.test&model_code=anthropic-native-e2e#platform-users-manager");
    await page.getByTestId("gateway-rate-limit-reason").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("gateway-rate-limit-reason-1440x1000.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(policyLink).toBeVisible();
    await page.getByTestId("gateway-rate-limit-reason").scrollIntoViewIfNeeded();
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("gateway-rate-limit-reason-390x844.png") });
    await policyLink.click();
    await expect(page).toHaveURL(/\/admin\/gateway\/rate-limits\?email=gateway-limited%40example\.test&model_code=anthropic-native-e2e#platform-users-manager$/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByRole("heading", { name: "用户默认 Token 上限" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "实时用量计数（只读）" })).toBeVisible();
    await expect(page.getByLabel("用户邮箱").first()).toHaveValue("gateway-limited@example.test");
    await page.getByRole("button", { name: "编辑" }).first().click();
    await page.getByLabel("每日 Token 限额").fill("1000");
    await page.getByRole("button", { name: "保存更改" }).click();
    await expect.poll(async () => Number((await pool.query(`SELECT daily_token_limit FROM platform_users WHERE id = $1`, [limitedGatewayUserId])).rows[0]?.daily_token_limit)).toBe(1000);
    const retryAfterLimitChange = await fetch(`${baseURL}/v1/messages?beta=true`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": limitedGatewayKey }, body: JSON.stringify({ model: "anthropic-native-e2e", max_tokens: 32, messages: [{ role: "user", content: "retry after raising user default limit" }] }) });
    expect(retryAfterLimitChange.status).toBe(200);
    await page.goto("/admin/models/permissions");
    await expect(page.getByText("RPM", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("每分钟请求数")).toHaveCount(0);
    await page.getByRole("button", { name: "新增模型授权" }).click();
    await expect(page.getByText("RPM", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("每分钟请求数")).toHaveCount(0);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto("/admin/subscriptions/entitlements");
    await expect(page.getByText("RPM", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "添加模型权益" }).click();
    await expect(page.getByText("RPM", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto("/admin/gateway/requests");
    await page.getByRole("button", { name: `查看 ${requestId} 详情` }).click();
    await expect(page.getByRole("heading", { name: "请求详情" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("gateway-request-detail-1440x1000.png") });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "二次确认并查看完整报文" }).click();
    await expect(page.getByTestId("gateway-full-payload")).toContainText("payload-marker-完整报文");
    const audit = await pool.query(`SELECT metadata FROM admin_audit_logs WHERE action = 'view_full_payload' AND resource_id = $1`, [requestId]);
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain("payload-marker-完整报文");
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("dialog").locator("aside").evaluate((element) => { element.scrollTop = 0; });
    await expect(page.getByRole("heading", { name: "请求详情" })).toBeVisible();
    expect(await page.locator("body").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("gateway-request-detail-390x844.png") });

    const leakage = await pool.query(`SELECT EXISTS (SELECT 1 FROM gateway_request_payloads WHERE headers::text LIKE $1 OR body_text LIKE $1) OR EXISTS (SELECT 1 FROM gateway_response_payloads WHERE headers::text LIKE $1 OR COALESCE(body_text, '') LIKE $1) OR EXISTS (SELECT 1 FROM admin_audit_logs WHERE COALESCE(before::text, '') LIKE $1 OR COALESCE(after::text, '') LIKE $1 OR COALESCE(metadata::text, '') LIKE $1) AS leaked`, [`%${gatewayKey}%`]);
    expect(leakage.rows[0].leaked).toBe(false);
    expect(browserErrors).toEqual([]);
    await pool.end();
  });
});
