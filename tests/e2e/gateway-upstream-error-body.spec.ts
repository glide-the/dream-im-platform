// [Input] Production GatewayRequestDetail/AIModelRegistry, synthetic DTOs, installed browser, and an owned fixture server.
// [Output] Provider-free proof for protected Gateway reveal and model-validation failure/success/denied feedback.
// [Pos] Component browser contract; it does not claim database persistence or server authorization acceptance.
// [Sync] 2026-10-02: render the production component with existing reveal semantics and no application/database writes.

import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

let server: Server | undefined;
let fixtureUrl = "";

test.beforeAll(async () => {
  const vitestRequire = createRequire(import.meta.resolve("vitest/package.json"));
  const viteRequire = createRequire(vitestRequire.resolve("vite/package.json"));
  const esbuild: { build(options: unknown): Promise<{ outputFiles: Array<{ text: string }> }> } = viteRequire("esbuild");
  const component = resolve("app/components/admin/GatewayRequestDetail.tsx");
  const modelRegistry = resolve("app/components/admin/AIModelRegistry.tsx");
  const bundle = await esbuild.build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import GatewayRequestDetail from ${JSON.stringify(component)};
        import AIModelRegistry from ${JSON.stringify(modelRegistry)};
        const component = new URLSearchParams(window.location.search).get("fixture") === "model"
          ? React.createElement(AIModelRegistry)
          : React.createElement(GatewayRequestDetail, {
          record: { id: "req-managed-error", protocol: "openai", http_status: 400, error_code: "UPSTREAM_REQUEST_REJECTED" },
          onClose: () => {},
        });
        createRoot(document.getElementById("root")).render(component);
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    logLevel: "silent",
    plugins: [{
      name: "model-fixture-boundaries",
      setup(build: {
        onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }): void;
        onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string; resolveDir: string }): void;
      }) {
        build.onResolve({ filter: /^(@refinedev\/core|next\/navigation|next\/link)$/ }, ({ path }) => ({ path, namespace: "fixture-boundary" }));
        build.onLoad({ filter: /.*/, namespace: "fixture-boundary" }, ({ path }) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents: path === "next/link"
            ? 'import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { ...props, href }, children); }'
            : path === "next/navigation"
              ? 'export function useSearchParams() { return new URLSearchParams(window.location.search); }'
              : `
                export function useCan() { return { data: { can: true } }; }
                export function useList({ resource }) {
                  const data = resource === "providers"
                    ? [{ id: "provider-managed", name: "Managed Provider", code: "managed" }]
                    : [{ id: "model-managed", code: "gpt-fixture", display_name: "Managed Model", provider_code: "managed", upstream_model: "gpt-fixture", enabled: true, provider_ready: true, pricing_ready: true, capabilities: { chat: true } }];
                  return { result: { data, total: data.length }, query: { isLoading: false, error: null } };
                }
              `,
        }));
      },
    }],
  });
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(bundle.outputFiles[0].text);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((ready, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", ready);
  });
  fixtureUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()));
});

for (const fixture of [
  { kind: "JSON", width: 1440, errorBody: { detail: "This model is not supported with this account.", code: "model_not_supported" } },
  { kind: "text", width: 390, errorBody: "This model is not supported with this account.\n" },
]) {
  test(`reveals ${fixture.kind} upstream errors through the existing payload action`, async ({ page }) => {
    const diagnostics: string[] = [];
    page.on("pageerror", (error) => diagnostics.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()); });
    page.on("requestfailed", (request) => diagnostics.push(request.failure()?.errorText ?? "request failed"));
    page.on("response", (response) => { if (response.status() >= 500) diagnostics.push(`HTTP ${response.status()}`); });
    let payloadReads = 0;
    await page.setViewportSize({ width: fixture.width, height: 844 });
    await page.route("**/api/admin/gateway-requests/req-managed-error/payload", async (route) => {
      expect(route.request().method()).toBe("GET");
      expect(route.request().headers()["x-gateway-payload-confirmation"]).toBe("reveal");
      payloadReads += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: {
          summary: {},
          request: null,
          response: { error_body: fixture.errorBody, body_json: { error: { code: "UPSTREAM_REQUEST_REJECTED" } } },
          events: [],
          rawSse: "",
        } }),
      });
    });
    await page.goto(fixtureUrl);
    await expect(page.getByRole("heading", { name: "请求详情", exact: true })).toBeVisible();
    expect(payloadReads).toBe(0);
    await expect(page.getByText("This model is not supported", { exact: false })).toHaveCount(0);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "二次确认并查看完整报文" }).click();
    const viewer = page.getByTestId("gateway-full-payload").locator("section").filter({ has: page.getByRole("heading", { name: "上游错误正文（凭据已脱敏）" }) });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("pre")).toHaveText(typeof fixture.errorBody === "string" ? fixture.errorBody : JSON.stringify(fixture.errorBody, null, 2));
    expect(payloadReads).toBe(1);
    expect(diagnostics).toEqual([]);
  });
}

test("keeps upstream errors hidden when payload access is denied", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/admin/gateway-requests/req-managed-error/payload", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "ADMIN_PERMISSION_DENIED", message: "Missing gateway.payloads.read" } }),
  }));
  await page.goto(fixtureUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "二次确认并查看完整报文" }).click();
  await expect(page.getByRole("alert")).toHaveText("Missing gateway.payloads.read");
  await expect(page.getByTestId("gateway-full-payload")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "上游错误正文（凭据已脱敏）" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`shows a model validation rejection and clears it after success at ${width}px`, async ({ page }) => {
    const diagnostics: string[] = [];
    page.on("pageerror", (error) => diagnostics.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()); });
    page.on("requestfailed", (request) => diagnostics.push(request.failure()?.errorText ?? "request failed"));
    page.on("response", (response) => { if (response.status() >= 500) diagnostics.push(`HTTP ${response.status()}`); });
    let validations = 0;
    const reason = "This model is not supported with this account.\nBearer [REDACTED]";
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/admin/models/model-managed/validate", async (route) => {
      expect(route.request().method()).toBe("POST");
      validations += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: validations === 1
        ? { status: "failed", usable: false, message: "上游未接受当前模型或协议配置", responseTimeMs: 1844, httpStatus: 400, upstreamMessage: reason, upstreamRequestId: "upstream-validation-1" }
        : { status: "operational", usable: true, message: "凭据与上游模型验证通过", responseTimeMs: 42, httpStatus: 200 },
      }) });
    });
    await page.goto(`${fixtureUrl}/?fixture=model`);
    expect(validations).toBe(0);
    await page.getByRole("button", { name: "验证配置" }).click();
    await expect(page.getByRole("status").filter({ hasText: "HTTP 400" })).toBeVisible();
    await expect(page.getByRole("alert").locator("pre")).toHaveText(reason);
    await expect(page.getByRole("alert")).toContainText("upstream-validation-1");
    await page.getByRole("button", { name: "验证配置" }).click();
    await expect(page.getByRole("status").filter({ hasText: "凭据与上游模型验证通过" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(validations).toBe(2);
    expect(diagnostics).toEqual([]);
  });
}

test("shows denied model validation without an upstream reason", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/admin/models/model-managed/validate", (route) => route.fulfill({
    status: 403, contentType: "application/json", body: JSON.stringify({ error: { message: "Missing models.write" } }),
  }));
  await page.goto(`${fixtureUrl}/?fixture=model`);
  await page.getByRole("button", { name: "验证配置" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Missing models.write" })).toBeVisible();
  await expect(page.getByText("上游具体原因", { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
