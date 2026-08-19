// [Input] Deployment capability environment for remote Git host allowlisting and bounded sync resources.
// [Output] Versioned, non-secret ClaudePlugin Marketplace synchronization policy.
// [Pos] Global Admin policy source consumed by app/lib/admin/claude-plugin-marketplaces.ts.
// [Sync] 2026-08-19: define the remote Marketplace v1 host and resource safety contract.

function positiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

const configuredHosts = (process.env.CLAUDE_PLUGIN_MARKETPLACE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export const claudePluginMarketplacePolicy = Object.freeze({
  revision: "remote-marketplace-v1",
  allowedHosts: Object.freeze(configuredHosts.length > 0 ? configuredHosts : ["github.com"]),
  syncTimeoutMs: positiveInteger("CLAUDE_PLUGIN_MARKETPLACE_SYNC_TIMEOUT_MS", 120_000),
  maxRepositoryBytes: positiveInteger("CLAUDE_PLUGIN_MARKETPLACE_MAX_REPOSITORY_BYTES", 128 * 1024 * 1024),
  maxMarketplaceManifestBytes: positiveInteger("CLAUDE_PLUGIN_MARKETPLACE_MAX_MANIFEST_BYTES", 1024 * 1024),
  maxPluginManifestBytes: positiveInteger("CLAUDE_PLUGIN_MARKETPLACE_MAX_PLUGIN_MANIFEST_BYTES", 256 * 1024),
  maxEntries: positiveInteger("CLAUDE_PLUGIN_MARKETPLACE_MAX_ENTRIES", 500),
  maxInventoryFiles: positiveInteger("CLAUDE_PLUGIN_MARKETPLACE_MAX_INVENTORY_FILES", 20_000),
});
