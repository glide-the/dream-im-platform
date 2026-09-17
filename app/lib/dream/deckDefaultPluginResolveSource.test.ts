// [Input] Actual Dream defaults/install service through a fixed source oracle and Registry104 DTOs.
// [Output] Legacy selection/verifier/evidence parity plus reviewed six-field Admin extension.
// [Pos] Cross-project source gate; it opens no pool, artifact filesystem or Claude CLI process.
// [Sync] 2026-09-15: bind the Admin candidate read to the original default-plugin behavior.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { deckDefaultPluginInstallationDto } from "./deckDefaultPluginResolveDto";

const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;

it.skipIf(!sourceRoot || !python)("matches the actual Dream default-plugin source and freezes the strict Admin extension", () => {
  const packageName = "platform.default-plugin", version = "1.2.3";
  const candidate = {
    id: "install-ready", package_name: packageName, marketplace: "official", resolved_version: version,
    artifact_digest: `sha256:${"a".repeat(64)}`, compatibility_json: '{"raw":true,"counter":9007199254740993}', status: "ready",
  };
  const request = {
    package: packageName,
    version,
    ordered_rows: [
      { ...candidate, id: "newest" },
      { ...candidate, id: "oldest", artifact_digest: `sha256:${"b".repeat(64)}` },
    ],
    items: [
      { ...candidate, id: "newer-mismatch", package_name: "other" },
      candidate,
      { ...candidate, id: "older-exact", artifact_digest: `sha256:${"b".repeat(64)}` },
    ],
  };
  const child = spawnSync(python!, ["-B", "tests/integration/deckDefaultPluginResolveSourceOracle.py"], {
    encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv,
    input: JSON.stringify(request),
  });
  expect(child.error, "Actual Dream interpreter must launch").toBeUndefined();
  expect(child.status, child.stderr || "Actual source must finish").toBe(0);
  const output = JSON.parse(child.stdout) as {
    ordered: typeof request.ordered_rows;
    ordering_sql: string[];
    success: { status: string; result: Record<string, unknown>; calls: { listed: number; artifact: string[]; cli: string[] }; closes: number };
    absent: { status: string; calls: { listed: number; artifact: string[]; cli: string[] }; closes: number };
    artifact_failure: { status: string; calls: { artifact: string[]; cli: string[] }; closes: number };
    cli_failure: { status: string; calls: { artifact: string[]; cli: string[] }; closes: number };
  };
  expect(output.ordered).toEqual(request.ordered_rows);
  expect(output.ordering_sql[0]).toContain("ORDER BY created_at DESC, id DESC");
  expect(output.success).toEqual({
    status: "resolved",
    result: {
      plugin_installation_id: candidate.id,
      package_name: packageName,
      resolved_version: version,
      artifact_digest: candidate.artifact_digest,
    },
    calls: { listed: 1, artifact: [candidate.id], cli: [candidate.id] },
    closes: 1,
  });
  expect(output.absent).toEqual({ status: "unavailable", calls: { listed: 1, artifact: [], cli: [] }, closes: 1 });
  expect(output.artifact_failure).toMatchObject({ status: "unavailable", calls: { artifact: [candidate.id], cli: [] }, closes: 1 });
  expect(output.cli_failure).toMatchObject({ status: "unavailable", calls: { artifact: [candidate.id], cli: [candidate.id] }, closes: 1 });

  expect(deckDefaultPluginInstallationDto.parse({
    plugin_installation_id: candidate.id,
    package_name: candidate.package_name,
    marketplace: candidate.marketplace,
    resolved_version: candidate.resolved_version,
    artifact_digest: candidate.artifact_digest,
    compatibility_json: candidate.compatibility_json,
  })).toEqual(expect.objectContaining({ marketplace: "official", compatibility_json: candidate.compatibility_json }));
  // Reviewed extension: Admin adds marketplace and raw compatibility metadata for Dream's unchanged local verifier.
});
