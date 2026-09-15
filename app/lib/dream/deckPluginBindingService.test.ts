// [Input] Strict binding DTOs, mocked typed repositories and existing compatibility fixtures.
// [Output] Owner, read projection, validation, CAS, no-op and atomic write behavior.
// [Pos] Provider-free Registry122-126 service verification.
// [Sync] 2026-09-16: lock the Deck Plugin binding Admin owner semantics.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { DeckPluginBindingRepository, type DeckPluginBindingRow } from "./deckPluginBindingRepository";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import {
  deckPluginBindingHistoryDto,
  deckPluginBindingResponseDto,
  deckPluginOptionsDto,
} from "./deckPluginBindingDto";
import { runDeckPluginBindingOperation } from "./deckPluginBindingService";

const principal = principalDto.parse({ subject: "subject", canonical_user_id: "1", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" });
const scope = { deck_id: "deck", workspace_id: "workspace" };
const selection = { ...scope, deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", apply_to: "next_run" as const };
const row = (patch: Partial<DeckPluginBindingRow> = {}): DeckPluginBindingRow => ({
  deck_plugin_binding_id: `dpb_${"1".repeat(32)}`, deck_id: "deck", workspace_id: "workspace", creator_id: "1",
  deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", binding_revision: 1, status: "active", applied_to: "next_run",
  created_at: "2026-09-16 00:00:00+00", updated_at: "2026-09-16 00:00:00+00", ...patch,
});

beforeEach(() => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000");
  vi.stubEnv("INK_DECK_HOST_COMPATIBLE", "true");
  vi.stubEnv("INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", "true");
  vi.stubEnv("INK_STORY_SCHEMA_COMPATIBLE", "true");
  vi.stubEnv("INK_DECK_RUNTIME_CONFIG_COMPATIBLE", "true");
  vi.spyOn(DeckPluginBindingRepository.prototype, "ownsDeckWorkspace").mockResolvedValue({ id: "deck" });
  const fixture = compatibilityFixture();
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "release").mockResolvedValue(fixture.release);
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "installation").mockResolvedValue(fixture.installation);
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "lock").mockResolvedValue(fixture.lockFacts);
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "materializations").mockResolvedValue([{ claude_code_plugin_id: "example.runtime", artifact_digest: fixture.lock.claude_code_plugins[0].artifact_digest,
    materialized_digest: fixture.lock.claude_code_plugins[0].artifact_digest, verification_status: "verified", declaration_status: "declared", materialization_status: "materialized", activation_status: "loaded" }]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Deck Plugin binding Admin service", () => {
  it("denies a foreign Deck/Workspace before reading binding facts", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "ownsDeckWorkspace").mockResolvedValue(null);
    const current = vi.spyOn(DeckPluginBindingRepository.prototype, "current");
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.current", scope, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "DECK_ACCESS_DENIED", status: 404 });
    expect(current).not.toHaveBeenCalled();
  });

  it("returns empty current state and ordered history with exact timestamps", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(null);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(2);
    expect(await runDeckPluginBindingOperation("deck-plugin-binding.current", scope, principal, {} as DataTransaction)).toEqual({ deck_id: "deck", binding_revision: 2, applied_to: "next_run", binding: null });
    vi.spyOn(DeckPluginBindingRepository.prototype, "history").mockResolvedValue([row({ binding_revision: 2 }), row({ deck_plugin_binding_id: `dpb_${"2".repeat(32)}`, binding_revision: 1, status: "stale" })]);
    const history = deckPluginBindingHistoryDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.history", { ...scope, limit: 50 }, principal, {} as DataTransaction));
    expect(history.entries.map(item => item.binding_revision)).toEqual([2, 1]);
    expect(history.entries[0].created_at).toBe("2026-09-16T00:00:00+00:00");
  });

  it("maps selectable, disabled and revoked options without accepting readiness input", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "selectableReleases").mockResolvedValue([
      { display_name: "Story", deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", status: "published" },
      { display_name: "Revoked", deck_plugin_id: "example.revoked", deck_plugin_version: "1.0.0", status: "revoked" },
    ]);
    vi.mocked(DeckPluginCompatibilityRepository.prototype.release).mockImplementation(async pluginId => (
      pluginId === "example.revoked"
        ? { ...compatibilityFixture().release, deck_plugin_id: pluginId, status: "revoked" }
        : compatibilityFixture().release
    ));
    const result = deckPluginOptionsDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.options", scope, principal, {} as DataTransaction));
    expect(result.options[0]).toMatchObject({ selectable: true, runtime_readiness: "materialized" });
    expect(result.options[1]).toMatchObject({ selectable: false, reason_code: "DECK_PLUGIN_UNAVAILABLE", release_status: "revoked" });
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.validate", { ...selection, ready: true }, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  });

  it("rejects stale CAS and exposes only the current revision", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(row());
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 0 }, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "BINDING_REVISION_CONFLICT", status: 409, details: { current_revision: 1 } });
  });

  it("keeps same selection idempotent without insert or draft advance", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(row());
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    const insert = vi.spyOn(DeckPluginBindingRepository.prototype, "insert");
    const advance = vi.spyOn(DeckPluginBindingRepository.prototype, "advanceDraftRevision");
    const result = deckPluginBindingResponseDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 1 }, principal, {} as DataTransaction));
    expect(result.binding_revision).toBe(1); expect(insert).not.toHaveBeenCalled(); expect(advance).not.toHaveBeenCalled();
  });

  it("stales the prior row, inserts revision and advances the Deck in the same caller UOW", async () => {
    const prior = row({ deck_plugin_id: "example.prior" });
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(prior);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    const stale = vi.spyOn(DeckPluginBindingRepository.prototype, "markCurrentStale").mockResolvedValue(true);
    const inserted = row({ deck_plugin_binding_id: `dpb_${"3".repeat(32)}`, binding_revision: 2 });
    const insert = vi.spyOn(DeckPluginBindingRepository.prototype, "insert").mockResolvedValue(inserted);
    const advance = vi.spyOn(DeckPluginBindingRepository.prototype, "advanceDraftRevision").mockResolvedValue();
    const result = deckPluginBindingResponseDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 1 }, principal, {} as DataTransaction));
    expect(result.binding_revision).toBe(2); expect(stale).toHaveBeenCalledWith(prior.deck_plugin_binding_id, 1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ binding_revision: 2 })); expect(advance).toHaveBeenCalledWith("deck");
  });

  it("returns structured selection rejection from current server facts", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(null);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(0);
    vi.spyOn(DeckPluginCompatibilityRepository.prototype, "installation").mockResolvedValue({ ...compatibilityFixture().installation, status: "disabled" });
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 0 }, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "SELECTION_NOT_ALLOWED", status: 422, details: { validation: { reason_code: "DECK_PLUGIN_DISABLED" } } });
  });
});
