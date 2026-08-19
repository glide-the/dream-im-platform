// [Input] Opt-in network access to the public Comfy-Org/comfy-skills Git repository and the production Marketplace inspector.
// [Output] Live transport, manifest, component, commit, and canonical full-plugin digest evidence for the requested Marketplace.
// [Pos] Explicit remote integration test; excluded from the default suite and never writes Admin or Dream business data.
// [Sync] 2026-08-19: verify the public Comfy Marketplace through the same immutable revision parser used by Admin sync.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { inspectMarketplaceCheckout } from "./claude-plugin-marketplaces";

const execFileAsync = promisify(execFile);
const runRemote = process.env.INK_RUN_REMOTE_MARKETPLACE_TEST === "1";

describe.skipIf(!runRemote)("Comfy Remote Marketplace integration", () => {
  it("loads and hashes Comfy-Org/comfy-skills through the production inspector", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "ink-comfy-marketplace-test-"));
    const checkout = join(temporaryRoot, "checkout");
    try {
      await execFileAsync(
        "git",
        [
          "-c",
          "protocol.file.allow=never",
          "-c",
          "protocol.ext.allow=never",
          "clone",
          "--depth",
          "1",
          "--no-tags",
          "--filter=blob:none",
          "https://github.com/Comfy-Org/comfy-skills",
          checkout,
        ],
        {
          timeout: 120_000,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            GIT_TERMINAL_PROMPT: "0",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
          },
        },
      );
      const { stdout } = await execFileAsync("git", ["-C", checkout, "rev-parse", "HEAD"]);
      const revision = await inspectMarketplaceCheckout(checkout, stdout.trim());
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
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 150_000);
});
