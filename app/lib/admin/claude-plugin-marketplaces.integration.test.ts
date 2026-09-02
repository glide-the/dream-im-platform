// [Input] Opt-in network access to public GitHub ClaudePlugin Marketplaces and the production remote checkout/inspector.
// [Output] Live commit-pinned sparse transport, manifest, component, and canonical full-plugin digest evidence.
// [Pos] Explicit remote integration test; excluded from the default suite and never writes Admin or Dream business data.
// [Sync] 2026-08-19: verify the public Comfy Marketplace through the same immutable revision parser used by Admin sync.
// [Sync] 2026-09-02: exercise the production GitHub API/raw transport with Comfy and MCP Apps.

import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { checkoutRemoteMarketplace } from "./claude-plugin-marketplaces";

const runRemote = process.env.INK_RUN_REMOTE_MARKETPLACE_TEST === "1";

describe.skipIf(!runRemote)("GitHub Remote Marketplace integration", () => {
  it("loads and hashes Comfy-Org/comfy-skills through the production transport", async () => {
    let temporaryRoot: string | null = null;
    try {
      const checkout = await checkoutRemoteMarketplace(
        "https://github.com/Comfy-Org/comfy-skills",
      );
      temporaryRoot = checkout.tempRoot;
      const revision = checkout.revision;
      const comfy = revision.entries.find((entry) => entry.packageName === "comfy-cloud");

      expect(revision.marketplaceName).toBe("comfy-skills");
      expect(revision.validationStatus).toBe("valid");
      expect(revision.resolvedCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(comfy).toMatchObject({
        packageSpec: "comfy-cloud@comfy-skills",
        version: "0.1.0",
        validationStatus: "valid",
      });
      expect(comfy?.componentInventory).toMatchObject({ commands: 12, mcpServers: 1 });
      expect(comfy?.pluginDigest).toBe(
        "sha256:a63778a6c4451006c66c31e308a15d717f8909b82252f077ab240bd30adf25f4",
      );
    } finally {
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  }, 150_000);

  it("loads modelcontextprotocol/ext-apps and its declared MCP Apps plugin", async () => {
    let temporaryRoot: string | null = null;
    try {
      const checkout = await checkoutRemoteMarketplace(
        "https://github.com/modelcontextprotocol/ext-apps",
      );
      temporaryRoot = checkout.tempRoot;
      expect(checkout.revision).toMatchObject({
        marketplaceName: "mcp-apps",
        validationStatus: "valid",
      });
      expect(checkout.revision.resolvedCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(checkout.revision.entries).toEqual([
        expect.objectContaining({
          packageName: "mcp-apps",
          packageSpec: "mcp-apps@mcp-apps",
          validationStatus: "valid",
        }),
      ]);
    } finally {
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  }, 150_000);
});
