// [Input] Production Provider registry, synthetic network DTOs and an owned styled component server.
// [Output] Switch persistence projection, failed-save/conflict recovery, permissions and narrow layout evidence.
// [Pos] Provider-free browser component contract; PostgreSQL persistence and authorization are separate server tests.
import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import postcss, { type AcceptedPlugin } from "postcss";
import tailwind from "@tailwindcss/postcss";
import type { ModelEgressPolicy } from "../../app/lib/model-egress-policy";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const require = createRequire(import.meta.resolve("vitest/package.json"));
  const viteRequire = createRequire(require.resolve("vite/package.json"));
  const esbuild: { build(options: unknown): Promise<{ outputFiles: Array<{ text: string }> }> } = viteRequire("esbuild");
  const bundle = await esbuild.build({
    stdin: { contents: `import React from "react"; import { createRoot } from "react-dom/client";
      import Registry from ${JSON.stringify(resolve("app/components/admin/AIProviderRegistry.tsx"))};
      createRoot(document.getElementById("root")).render(React.createElement(Registry));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "refine-boundary", setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string; resolveDir: string }): void;
    }) {
      build.onResolve({ filter: /^(@refinedev\/core|next\/navigation|next\/link)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", resolveDir: process.cwd(), contents:
        path === "next/link" ? 'import React from "react"; export default function Link({href, children, ...props}) { return React.createElement("a", {...props, href}, children); }' :
        path === "next/navigation" ? 'export function useRouter() { return {push: () => {}}; }' :
        'export function useCan() { return {data: {can: !location.search.includes("readonly")}}; } export function useList() { return {result: {data: [],total:0}, query: {isLoading:false,error:null,refetch:async()=>{}}}; }',
      }));
    } }],
  });
  // Installed plugin and app use compatible PostCSS 8 runtimes with separate declaration versions.
  const css = await postcss([tailwind() as unknown as AcceptedPlugin]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") });
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript" }); response.end(bundle.outputFiles[0].text); }
    else if (request.url === "/fixture.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(css.css); }
    else { response.writeHead(200, { "content-type": "text/html" }); response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main style="max-width:1200px;margin:auto;padding:16px"><div id="root"></div></main><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((done) => server.close(() => done())); });

for (const width of [1440, 390]) {
  test(`Provider-wide switch saves, reloads and recovers from a stale revision at ${width}px`, async ({ page }, info) => {
    const diagnostics: string[] = [];
    page.on("pageerror", (error) => diagnostics.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("409")) diagnostics.push(message.text()); });
    page.on("requestfailed", (request) => diagnostics.push(request.failure()?.errorText ?? "request failed"));
    page.on("response", (response) => { if (response.status() >= 500) diagnostics.push(`HTTP ${response.status()}`); });
    let policy: ModelEgressPolicy = { defaultEnabled: false, desiredEnabled: false, effectiveEnabled: false, configured: true, revision: null, status: "disabled" };
    let conflict = false;
    const mutations: unknown[] = [];
    await page.route("**/api/admin/model-egress", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON(); mutations.push(body);
        if (conflict) { await route.fulfill({ status: 409, json: { error: { message: "代理设置已被其他管理员修改，请刷新后重试" } } }); return; }
        expect(body.expectedRevision).toBe(policy.revision);
        policy = { ...policy, desiredEnabled: body.enabled, effectiveEnabled: body.enabled, status: body.enabled ? "enabled" : "disabled", revision: (policy.revision ?? 0) + 1 };
      }
      await route.fulfill({ json: { data: policy } });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "供应商", exact: true })).toBeVisible();
    const control = page.getByRole("switch", { name: "启用本机 Docker NAT 代理" });
    await expect(control).toBeEnabled(); await expect(control).not.toBeChecked();
    await control.focus(); await page.keyboard.press("Space");
    await expect(control).toBeChecked(); await expect(page.getByRole("status").filter({ hasText: /^已启用$/ })).toBeVisible();
    expect(mutations[0]).toEqual({ enabled: true, expectedRevision: null });
    await page.screenshot({ path: info.outputPath(`provider-network-enabled-${width}.png`), fullPage: true });
    await page.reload(); await expect(control).toBeChecked();
    conflict = true; await control.click();
    await expect(page.getByRole("alert")).toContainText("已被其他管理员修改"); await expect(control).toBeChecked();
    policy = { ...policy, revision: 2 }; conflict = false;
    await page.getByRole("button", { name: "重新读取设置" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await control.click(); await expect(control).not.toBeChecked();
    expect(mutations.at(-1)).toEqual({ enabled: false, expectedRevision: 2 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`provider-network-${width}.png`), fullPage: true });
    expect(diagnostics).toEqual([]);
  });
}
test("read-only and missing proxy capability keep the switch unavailable", async ({ page }) => {
  let configured = true;
  let writes = 0;
  await page.route("**/api/admin/model-egress", async route => {
    if (route.request().method() === "PATCH") writes++;
    await route.fulfill({ json: { data: { defaultEnabled: false, desiredEnabled: false, effectiveEnabled: false, configured, revision: null, status: "disabled" } } });
  });
  await page.goto(`${origin}/?readonly`);
  const control = page.getByRole("switch"); await expect(control).toBeDisabled();
  configured = false; await page.goto(origin);
  await expect(page.getByText("服务器尚未配置可用的本机代理地址，请联系运维配置。")).toBeVisible();
  await expect(control).toBeDisabled(); expect(writes).toBe(0);
});
