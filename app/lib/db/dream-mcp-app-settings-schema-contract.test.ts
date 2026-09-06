// [Input] Current Admin Drizzle MCP Server declaration and the generated 0053 forward migration.
// [Output] Exact additive, deny-by-default, revisioned per-connection MCP App settings evidence.
// [Pos] Provider-free schema contract for dream.mcp-app-connection-settings.v1.
// [Sync] 2026-09-06: add the first per-connection MCP App settings capability contract.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { dream_mcp_servers } from "./schema/dream";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0053_rare_lenny_balinger.sql"),
  "utf8",
);

const contractLines = [
  "capability|dream.mcp-app-connection-settings.v1|version=1",
  "table|dream_mcp_servers",
  "columns|app_desired_enabled:boolean:not-null:default-false,app_desired_low_risk_tool_calls:boolean:not-null:default-false,app_desired_ui_messages:boolean:not-null:default-false,app_settings_revision:integer:not-null:default-1",
  "constraints|app-settings-revision>=1",
  "ownership|user-desired-only,no-credential,no-sandbox,no-deployment-config",
] as const;

const expectedContractSha256 =
  "c8a1daebd20db54890ca31bf154faad4bd6f2714c609dba413acca88e2139202";

describe("Dream MCP App connection settings schema capability", () => {
  it("adds only the revisioned desired state to the existing Server relation", () => {
    const columns = getTableColumns(dream_mcp_servers);
    expect(Object.keys(columns)).toEqual(expect.arrayContaining([
      "app_desired_enabled",
      "app_desired_low_risk_tool_calls",
      "app_desired_ui_messages",
      "app_settings_revision",
    ]));
    expect(migration).toContain('DEFAULT false NOT NULL');
    expect(migration).toContain('DEFAULT 1 NOT NULL');
    expect(migration).toContain('ck_dream_mcp_servers_app_settings_revision');
    expect(migration).not.toMatch(/credential|sandbox_url|deployment_config/i);
  });

  it("publishes the exact capability only after every additive DDL statement", () => {
    const contractSha256 = createHash("sha256")
      .update(contractLines.join("\n"), "utf8")
      .digest("hex");
    const lastDdl = migration.lastIndexOf('ALTER TABLE "dream_mcp_servers"');
    const capability = migration.lastIndexOf('dream.mcp-app-connection-settings.v1');
    expect(contractSha256).toBe(expectedContractSha256);
    expect(capability).toBeGreaterThan(lastDdl);
    expect(migration).toContain(expectedContractSha256);
    expect(migration).toContain('"defaultEnabled":false');
    expect(migration).toContain('"serverManagedDeployment":true');
  });
});
