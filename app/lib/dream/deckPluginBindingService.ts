// [Input] Strict Registry122-126 DTO, OAuth principal and caller-owned Admin transaction.
// [Output] Original binding projections with owner checks, compatibility, CAS and draft revision semantics.
// [Pos] DTO-Service-typed ORM composition; Dream retains HTTP UI, Runtime and shared filesystem execution.
// [Sync] 2026-09-16: implement five Admin-owned Deck Plugin binding operations.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { pgTimestampToIso } from "./chatThreadDto";
import { DeckPluginBindingRepository, type DeckPluginBindingRow } from "./deckPluginBindingRepository";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import { evaluateDeckPluginCompatibility, resolveDeckRuntimeContext, storedPluginStringSet } from "./deckPluginCompatibilityService";
import * as dto from "./deckPluginBindingDto";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";

export const deckPluginBindingSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

const recovery = {
  DECK_PLUGIN_UNAVAILABLE: { owner: "deck_plugin_admin", action: "select_an_available_installed_release" },
  DECK_PLUGIN_DISABLED: { owner: "deck_plugin_admin", action: "enable_the_installation_or_select_another_release" },
  DECK_PLUGIN_UPGRADE_PENDING: { owner: "deck_plugin_admin", action: "approve_the_capability_expansion_or_keep_the_ready_version" },
  RUNTIME_CONTEXT_UNAVAILABLE: { owner: "runtime_platform", action: "restore_server_side_compatibility_and_readiness_signals" },
} as const;

function unavailable(releaseStatus: string, installationStatus: string, reason: keyof typeof recovery, compatibility: "failed" | "unknown" = "failed"): dto.DeckPluginSelectionSummary {
  return dto.deckPluginSelectionSummaryDto.parse({ selectable: false, release_status: releaseStatus, installation_status: installationStatus,
    compatibility, runtime_readiness: "unknown", reason_code: reason, recovery: recovery[reason], capability_summary: [] });
}

function compatibilityOwner(check: string | null) {
  if (check === "workflow_permission") return "workspace_admin";
  if (check === "runtime_plugin_ready") return "runtime_platform";
  return "deck_plugin_publisher";
}

async function selectionSummary(tx: DataTransaction, workspaceId: string, pluginId: string, pluginVersion: string): Promise<dto.DeckPluginSelectionSummary> {
  const store = new DeckPluginCompatibilityRepository(tx);
  const release = await store.release(pluginId, pluginVersion);
  if (!release) return unavailable("missing", "missing", "DECK_PLUGIN_UNAVAILABLE");
  if (!new Set(["published", "deprecated"]).has(release.status)) return unavailable(release.status, "unknown", "DECK_PLUGIN_UNAVAILABLE");
  const installation = await store.installation(pluginId, workspaceId, false);
  if (!installation) return unavailable(release.status, "missing", "DECK_PLUGIN_UNAVAILABLE");
  if (installation.status === "disabled") return unavailable(release.status, installation.status, "DECK_PLUGIN_DISABLED");
  if (installation.status === "upgrade_pending") return unavailable(release.status, installation.status, "DECK_PLUGIN_UPGRADE_PENDING");
  if (installation.status !== "ready" || !storedPluginStringSet(installation.installed_versions_json).has(pluginVersion)) {
    return unavailable(release.status, installation.status, "DECK_PLUGIN_UNAVAILABLE");
  }
  let facts: Awaited<ReturnType<typeof resolveDeckRuntimeContext>>;
  try { facts = await resolveDeckRuntimeContext(store, { workspace_id: workspaceId, deck_plugin_id: pluginId, deck_plugin_version: pluginVersion }); }
  catch { return unavailable(release.status, installation.status, "RUNTIME_CONTEXT_UNAVAILABLE", "unknown"); }
  const result = evaluateDeckPluginCompatibility(
    { workspace_id: workspaceId, deck_plugin_id: pluginId, deck_plugin_version: pluginVersion },
    facts.release,
    installation,
    facts.lockFacts,
    facts.context,
  );
  if (result.passed) return dto.deckPluginSelectionSummaryDto.parse({ selectable: true, release_status: release.status,
    installation_status: installation.status, compatibility: "passed", runtime_readiness: "materialized", reason_code: null,
    recovery: null, capability_summary: result.effective_capabilities });
  const late = result.failed_check === "workflow_permission" || result.failed_check === "runtime_plugin_ready";
  return dto.deckPluginSelectionSummaryDto.parse({ selectable: false, release_status: release.status,
    installation_status: installation.status, compatibility: late ? "passed" : "failed",
    runtime_readiness: result.failed_check === "runtime_plugin_ready" ? "not_ready" : "unknown",
    reason_code: result.error_code ?? "DECK_PLUGIN_UNAVAILABLE",
    recovery: { owner: compatibilityOwner(result.failed_check), action: result.recovery_action ?? "select_another_release" },
    capability_summary: [] });
}

function bindingResponse(row: DeckPluginBindingRow, validation: dto.DeckPluginSelectionSummary) {
  return dto.deckPluginBindingResponseDto.parse({
    deck_plugin_binding_id: row.deck_plugin_binding_id,
    deck_id: row.deck_id,
    deck_plugin_id: row.deck_plugin_id,
    deck_plugin_version: row.deck_plugin_version,
    binding_revision: row.binding_revision,
    status: row.status,
    applied_to: row.applied_to,
    selection_validation_summary: validation,
  });
}

function bindingHistoryEntry(row: DeckPluginBindingRow) {
  return dto.deckPluginBindingHistoryEntryDto.parse({
    deck_plugin_binding_id: row.deck_plugin_binding_id,
    deck_plugin_id: row.deck_plugin_id,
    deck_plugin_version: row.deck_plugin_version,
    binding_revision: row.binding_revision,
    status: row.status,
    applied_to: row.applied_to,
    created_at: pgTimestampToIso(row.created_at)!,
    updated_at: pgTimestampToIso(row.updated_at)!,
  });
}

export async function runDeckPluginBindingOperation(operation: dto.DeckPluginBindingOperation, rawInput: unknown, rawPrincipal: unknown, tx: DataTransaction) {
  const contract = dto.deckPluginBindingOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data as dto.DeckPluginBindingScopeInput;
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new DeckPluginBindingRepository(tx, principal.canonical_user_id);
  const mutating = operation === "deck-plugin-binding.save";
  if (!await store.ownsDeckWorkspace(input.deck_id, input.workspace_id, mutating ? "update" : "share")) {
    throw new AuthBoundaryError("DECK_ACCESS_DENIED", 404);
  }

  let result: unknown;
  switch (operation) {
    case "deck-plugin-binding.current": {
      const row = await store.current(input.deck_id);
      result = { deck_id: input.deck_id, binding_revision: row?.binding_revision ?? await store.latestRevision(input.deck_id), applied_to: "next_run",
        binding: row ? bindingResponse(row, await selectionSummary(tx, input.workspace_id, row.deck_plugin_id, row.deck_plugin_version)) : null };
      break;
    }
    case "deck-plugin-binding.history": {
      const historyInput = dto.deckPluginBindingHistoryInputDto.parse(parsed.data);
      result = { deck_id: input.deck_id, current_binding_revision: await store.latestRevision(input.deck_id),
        entries: (await store.history(input.deck_id, historyInput.limit)).map(bindingHistoryEntry) };
      break;
    }
    case "deck-plugin-binding.options": {
      const options = [];
      for (const row of await store.selectableReleases()) {
        const summary = await selectionSummary(tx, input.workspace_id, row.deck_plugin_id, row.deck_plugin_version);
        options.push({ display_name: row.display_name, deck_plugin_id: row.deck_plugin_id, deck_plugin_version: row.deck_plugin_version,
          release_status: summary.release_status, installation_status: summary.installation_status, compatibility: summary.compatibility,
          runtime_readiness: summary.runtime_readiness, selectable: summary.selectable, reason_code: summary.reason_code,
          recovery: summary.recovery, capability_summary: summary.capability_summary });
      }
      result = { deck_id: input.deck_id, applied_to: "next_run", options };
      break;
    }
    case "deck-plugin-binding.validate": {
      const selection = dto.deckPluginBindingSelectionInputDto.parse(parsed.data);
      result = { deck_id: selection.deck_id, deck_plugin_id: selection.deck_plugin_id, deck_plugin_version: selection.deck_plugin_version,
        applied_to: "next_run", validation: await selectionSummary(tx, selection.workspace_id, selection.deck_plugin_id, selection.deck_plugin_version) };
      break;
    }
    case "deck-plugin-binding.save": {
      const save = dto.deckPluginBindingSaveInputDto.parse(parsed.data);
      const current = await store.current(save.deck_id, "update");
      const latest = await store.latestRevision(save.deck_id);
      if (save.expected_binding_revision !== latest) throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: latest });
      const validation = await selectionSummary(tx, save.workspace_id, save.deck_plugin_id, save.deck_plugin_version);
      if (!validation.selectable) throw new AuthBoundaryError("SELECTION_NOT_ALLOWED", 422, { validation });
      if (current && current.deck_plugin_id === save.deck_plugin_id && current.deck_plugin_version === save.deck_plugin_version) {
        result = bindingResponse(current, validation);
        break;
      }
      if (current && !await store.markCurrentStale(current.deck_plugin_binding_id, current.binding_revision)) {
        throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: await store.latestRevision(save.deck_id) });
      }
      const created = await store.insert({ ...save, binding_revision: latest + 1 });
      await store.advanceDraftRevision(save.deck_id);
      result = bindingResponse(created, validation);
      break;
    }
  }
  return contract.output.parse(result);
}
