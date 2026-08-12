// Contract tests keep policy config, Drizzle defaults, migration, and runner aligned.
import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { gatewayDefaultLimitsPolicy } from "../../../config/gateway-default-limits.mjs";
import { platformUsers } from "./schema";

describe("Gateway default Token limit policy", () => {
  it("uses the versioned billion/ten-billion 429 defaults", () => {
    expect(gatewayDefaultLimitsPolicy).toEqual({
      revision: "gateway-default-token-limits-v1",
      dailyTokenLimit: 1_000_000_000,
      monthlyTokenLimit: 10_000_000_000,
    });
    const columns = new Map(
      getTableConfig(platformUsers).columns.map((column) => [column.name, column]),
    );
    expect(columns.get("daily_token_limit")?.default).toBe(1_000_000_000);
    expect(columns.get("monthly_token_limit")?.default).toBe(10_000_000_000);
  });

  it("keeps schema defaults separate from the explicit all-user backfill", async () => {
    const migration = await readFile(
      new URL("../../../drizzle/0035_brief_wolverine.sql", import.meta.url),
      "utf8",
    );
    const runner = await readFile(
      new URL(
        "../../../drizzle/data/gateway-default-token-limits.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER COLUMN "daily_token_limit" SET DEFAULT 1000000000',
    );
    expect(migration).toContain(
      'ALTER COLUMN "monthly_token_limit" SET DEFAULT 10000000000',
    );
    expect(migration).not.toMatch(/UPDATE\s+"?platform_users"?/i);
    expect(runner).toMatch(/UPDATE platform_users/);
    expect(runner).toContain("--apply");
    expect(runner).toContain("effect: \"429-only\"");
  });
});
