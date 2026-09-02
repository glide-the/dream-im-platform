// [Input] Temporary remote-checkout fixtures and the Admin Marketplace validation service.
// [Output] Unit evidence for accepted catalogs, canonical content digests, GitHub remote parsing, and fail-closed source errors.
// [Pos] Focused contract tests for the Remote Marketplace control plane.
// [Sync] 2026-08-19: cover valid global catalog extraction and invalid source rejection.
// [Sync] 2026-09-02: cover normalized GitHub archive routing without weakening the HTTPS host policy.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AdminError } from "./errors";
import {
  inspectMarketplaceCheckout,
  normalizeMarketplaceRemoteUrl,
  parseGitHubMarketplaceRemote,
} from "./claude-plugin-marketplaces";

const temporaryRoots: string[] = [];

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "ink-marketplace-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("ClaudePlugin remote Marketplace inspection", () => {
  it("extracts a Comfy-shaped global catalog without an object-store artifact", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await mkdir(join(root, "claude-code", ".claude-plugin"), { recursive: true });
    await mkdir(join(root, "claude-code", "commands"), { recursive: true });
    await writeJson(join(root, ".claude-plugin", "marketplace.json"), {
      name: "comfy-skills",
      description: "Comfy skills",
      plugins: [
        {
          name: "comfy-cloud",
          source: "./claude-code",
          description: "Comfy Cloud in Claude Code",
          homepage: "https://docs.comfy.org/cloud/mcp",
        },
      ],
    });
    await writeJson(join(root, "claude-code", ".claude-plugin", "plugin.json"), {
      name: "comfy-cloud",
      version: "0.1.0",
      mcpServers: {
        "comfy-cloud": { type: "http", url: "https://cloud.comfy.org/mcp" },
      },
    });
    await writeFile(join(root, "claude-code", "commands", "generate-image.md"), "# Generate", "utf8");

    const revision = await inspectMarketplaceCheckout(root, "a".repeat(40));

    expect(revision.validationStatus).toBe("valid");
    expect(revision.marketplaceName).toBe("comfy-skills");
    expect(revision.entries).toHaveLength(1);
    expect(revision.entries[0]).toMatchObject({
      packageName: "comfy-cloud",
      packageSpec: "comfy-cloud@comfy-skills",
      version: "0.1.0",
      validationStatus: "valid",
      componentInventory: {
        commands: 1,
        mcpServers: 1,
      },
    });
    expect(revision.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(revision.entries[0].pluginManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(revision.entries[0].pluginDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const approvedDigest = revision.entries[0].pluginDigest;
    await writeFile(join(root, "claude-code", "commands", "generate-image.md"), "# Changed", "utf8");
    const changedRevision = await inspectMarketplaceCheckout(root, "b".repeat(40));
    expect(changedRevision.entries[0].pluginDigest).not.toBe(approvedDigest);
  });

  it("persists an invalid projection when an entry source escapes the remote checkout", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeJson(join(root, ".claude-plugin", "marketplace.json"), {
      name: "unsafe-marketplace",
      plugins: [{ name: "unsafe-plugin", source: "../outside" }],
    });

    const revision = await inspectMarketplaceCheckout(root, "b".repeat(40));

    expect(revision.validationStatus).toBe("invalid");
    expect(revision.entries[0].validationErrors).toContain(
      "CLAUDE_PLUGIN_MARKETPLACE_SOURCE_UNSUPPORTED",
    );
  });

  it("accepts only credential-free HTTPS remotes from the configured host policy", () => {
    expect(
      normalizeMarketplaceRemoteUrl("https://github.com/Comfy-Org/comfy-skills"),
    ).toBe("https://github.com/Comfy-Org/comfy-skills");
    expect(() =>
      normalizeMarketplaceRemoteUrl("http://github.com/Comfy-Org/comfy-skills"),
    ).toThrowError(AdminError);
    expect(() =>
      normalizeMarketplaceRemoteUrl("https://example.invalid/marketplace"),
    ).toThrowError(/allowlist/);
  });

  it("routes only canonical GitHub repository URLs through immutable archives", () => {
    expect(
      parseGitHubMarketplaceRemote(
        normalizeMarketplaceRemoteUrl(
          "https://github.com/modelcontextprotocol/ext-apps.git",
        ),
      ),
    ).toEqual({ owner: "modelcontextprotocol", repository: "ext-apps" });
    expect(
      parseGitHubMarketplaceRemote(
        normalizeMarketplaceRemoteUrl(
          "https://github.com/modelcontextprotocol/ext-apps/tree/main",
        ),
      ),
    ).toBeNull();
  });
});
