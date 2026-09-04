// [Input] Provider/credential/attempt inventories and deleted-Provider orphan runner/registry source contracts.
// [Output] Proof that only live orphans are invalidated, repeats are no-ops, and receipts never claim remote revocation.
// [Pos] Focused Provider-free regression contract for provider-deleted-credential-orphans-v1.
// [Sync] 2026-09-04: protect valid active/disabled owners and require secret-safe, truthful local invalidation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  planDeletedProviderCredentialOrphanRepair,
  type DeletedProviderOrphanAttemptRow,
  type DeletedProviderOrphanCredentialRow,
  type DeletedProviderOrphanProviderRow,
} from "../../../drizzle/data/provider-deleted-credential-orphans-core";

const root = process.cwd();
const migrationCore = readFileSync(resolve(
  root,
  "drizzle/data/provider-deleted-credential-orphans-core.ts",
), "utf8");
const registry = readFileSync(resolve(root, "drizzle/data/registry.mjs"), "utf8");

function provider(
  id: string,
  status: string,
  credentialId: string | null,
): DeletedProviderOrphanProviderRow {
  return {
    id,
    adapter_kind: "codex",
    status,
    managed_credential_id: credentialId,
  };
}

function credential(
  id: string,
  providerId: string | null,
  status: DeletedProviderOrphanCredentialRow["status"] = "connected",
): DeletedProviderOrphanCredentialRow {
  return {
    id,
    provider_id: providerId,
    adapter_kind: "codex",
    status,
    auth_epoch: 2,
    revision: 3,
    bundle_format_version: status === "connected" ? 1 : null,
    bundle_key_id: status === "connected" ? "key" : null,
    bundle_ciphertext: status === "connected" ? "ciphertext" : null,
    bundle_nonce: status === "connected" ? "nonce" : null,
    bundle_tag: status === "connected" ? "tag" : null,
  };
}

function attempt(
  id: string,
  providerId: string,
  credentialId: string | null,
): DeletedProviderOrphanAttemptRow {
  return {
    id,
    provider_id: providerId,
    adapter_kind: "codex",
    target_credential_id: credentialId,
    status: "pending",
    revision: 1,
  };
}

describe("deleted-Provider credential orphan planner", () => {
  it.each(["active", "disabled"])(
    "preserves a valid %s Provider and its directly owned live credential",
    (status) => {
      const plan = planDeletedProviderCredentialOrphanRepair({
        providers: [provider("provider-safe", status, "credential-safe")],
        credentials: [credential("credential-safe", "provider-safe")],
        attempts: [],
      });

      expect(plan).toEqual({
        providerTargets: [],
        credentialTargets: [],
        attemptTargets: [],
        providerRowsChanged: 0,
        credentialRowsChanged: 0,
        attemptRowsChanged: 0,
      });
    },
  );

  it("invalidates a deleted Provider's live credential and active attempt", () => {
    const plan = planDeletedProviderCredentialOrphanRepair({
      providers: [provider("provider-deleted", "deleted", "credential-orphan")],
      credentials: [credential("credential-orphan", "provider-deleted")],
      attempts: [attempt("attempt-active", "provider-deleted", "credential-orphan")],
    });

    expect(plan).toMatchObject({
      providerTargets: [{
        providerId: "provider-deleted",
        credentialId: "credential-orphan",
      }],
      credentialTargets: [{
        credentialId: "credential-orphan",
        providerId: "provider-deleted",
        status: "connected",
      }],
      attemptTargets: [{ attemptId: "attempt-active", status: "pending" }],
      providerRowsChanged: 1,
      credentialRowsChanged: 1,
      attemptRowsChanged: 1,
    });
  });

  it.each([
    {
      label: "missing owner",
      providers: [],
      providerId: "provider-missing",
    },
    {
      label: "owner pointer mismatch",
      providers: [provider("provider-active", "active", "credential-other")],
      providerId: "provider-active",
    },
  ])("invalidates a live credential with $label without clearing a valid pointer", ({
    providers,
    providerId,
  }) => {
    const plan = planDeletedProviderCredentialOrphanRepair({
      providers,
      credentials: [credential("credential-orphan", providerId)],
      attempts: [],
    });

    expect(plan.providerTargets).toEqual([]);
    expect(plan.credentialTargets).toHaveLength(1);
    expect(plan.credentialRowsChanged).toBe(1);
  });

  it("is idempotent after the local invalidation state is applied", () => {
    const plan = planDeletedProviderCredentialOrphanRepair({
      providers: [provider("provider-deleted", "deleted", null)],
      credentials: [credential(
        "credential-history",
        null,
        "disconnected",
      )],
      attempts: [{
        ...attempt("attempt-history", "provider-deleted", "credential-history"),
        status: "cancelled",
        revision: 2,
      }],
    });

    expect(plan.providerRowsChanged).toBe(0);
    expect(plan.credentialRowsChanged).toBe(0);
    expect(plan.attemptRowsChanged).toBe(0);
  });

  it("clears a deleted Provider pointer to disconnected history without mutating the credential", () => {
    const plan = planDeletedProviderCredentialOrphanRepair({
      providers: [provider(
        "provider-deleted",
        "deleted",
        "credential-history",
      )],
      credentials: [credential(
        "credential-history",
        "provider-deleted",
        "disconnected",
      )],
      attempts: [],
    });

    expect(plan.providerTargets).toEqual([{
      providerId: "provider-deleted",
      credentialId: "credential-history",
    }]);
    expect(plan.providerRowsChanged).toBe(1);
    expect(plan.credentialRowsChanged).toBe(0);
  });
});

describe("deleted-Provider credential orphan execution contract", () => {
  it("erases local secrets and never creates or reports a successful remote revoke", () => {
    expect(migrationCore).toContain("bundle_ciphertext = NULL");
    expect(migrationCore).toContain("refresh_lease_id = NULL");
    expect(migrationCore).toContain("granted_scopes = ARRAY[]::text[]");
    expect(migrationCore).toContain("revocation_status = 'not_attempted'");
    expect(migrationCore).toContain('remoteRevocation: "not_attempted"');
    expect(migrationCore).toContain("revocationJobsCreated: 0");
    expect(migrationCore).toContain("remoteRevocationsSucceeded: 0");
    expect(migrationCore).toContain("credentialsDeleted: 0");
    expect(migrationCore).not.toMatch(/INSERT INTO ai_provider_revocation_jobs/i);
    expect(migrationCore).not.toMatch(/DELETE FROM ai_provider_managed_credentials/i);
    expect(migrationCore).not.toContain("processProviderRevocationJob");
    expect(registry).toContain("recordProviderDeletedCredentialOrphansReceipt");
    expect(registry).toContain('receipt.remoteRevocation !== "not_attempted"');
  });

  it("uses a serializable transaction, locks owned tables, and CAS-updates exact rows", () => {
    expect(migrationCore).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(migrationCore).toContain("pg_advisory_xact_lock");
    expect(migrationCore).toContain("IN SHARE ROW EXCLUSIVE MODE");
    expect(migrationCore).toContain("AND managed_credential_id = $2");
    expect(migrationCore).toContain("AND provider_id IS NOT DISTINCT FROM $4");
    expect(migrationCore).toContain('else await client.query("ROLLBACK")');
  });
});
