// [Input] Admin Drizzle ai_models declaration, 0041 migration, snapshot, journal, and Runtime capability config.
// [Output] Prove additive nullable positive storage and exact capability publication for Dream.
// [Pos] Provider-free schema contract for dream.claude-code-runtime-config.v1.
// [Sync] 2026-09-02: locate 0041 by immutable tag so later forward migrations remain valid.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { aiModels } from "@ink-memory/db/schema";
import { claudeAgentResourcePolicy } from "../../../config/claude-agent-resource-policy";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0041_claude_code_runtime_config.sql"),
  "utf8",
);
const snapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/0041_snapshot.json"),
  "utf8",
));
const journal = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/_journal.json"),
  "utf8",
));

describe("Claude Code Runtime schema capability", () => {
  it("declares two nullable int4 model settings with positive checks", () => {
    const columns = getTableColumns(aiModels);
    expect(columns.claude_code_auto_compact_window).toBeDefined();
    expect(columns.claude_code_auto_compact_window.notNull).toBe(false);
    expect(columns.claude_code_max_context_tokens).toBeDefined();
    expect(columns.claude_code_max_context_tokens.notNull).toBe(false);

    const table = snapshot.tables["public.ai_models"];
    expect(table.columns.claude_code_auto_compact_window.type).toBe("integer");
    expect(table.columns.claude_code_max_context_tokens.type).toBe("integer");
    expect(table.checkConstraints).toHaveProperty(
      "ai_models_claude_code_auto_compact_window_check",
    );
    expect(table.checkConstraints).toHaveProperty(
      "ai_models_claude_code_max_context_tokens_check",
    );
  });

  it("keeps 0041 additive and publishes the exact capability after DDL", () => {
    for (const token of [
      "claude_code_auto_compact_window",
      "claude_code_max_context_tokens",
      "IS NULL OR",
      "> 0",
      "'dream.claude-code-runtime-config.v1'",
      "'admin-drizzle-0041'",
      `'${claudeAgentResourcePolicy.claudeCodeRuntime.contractSha256}'`,
      '"omitWhenUnset":true',
      '"resourcePolicyField":"claudeCodeEffortLevel"',
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|ALTER\s+COLUMN|CREATE\s+TRIGGER)\b/i);
    expect(migration.lastIndexOf("dream.claude-code-runtime-config.v1"))
      .toBeGreaterThan(migration.lastIndexOf("ADD CONSTRAINT"));
    expect(
      journal.entries.find(
        (entry: { tag?: string }) => entry.tag === "0041_claude_code_runtime_config",
      ),
    ).toMatchObject({
      idx: 41,
      tag: "0041_claude_code_runtime_config",
      version: "7",
    });
  });
});
