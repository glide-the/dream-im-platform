// [Input] Canonical Image schema contract lines, source schema, generated snapshot, journal, and forward migration.
// [Output] Regression proof that gateway.images.v1 is exact and published only after validation.
// [Pos] Provider-free schema contract test for the Images Gateway capability.
// [Sync] 2026-10-09: lock migration 0078 fields, scope, hash, and publish order.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { imageApiPolicy } from "../../../config/image-api-policy";

const contractLines = [
  "gateway.images.v1|version=1",
  "ai_models.image_input_token_reserve_per_image|integer|null|positive",
  "ai_models.image_output_token_reserve_per_image|integer|null|positive",
  "ai_pricing_rules.image_input_price_microusd_per_million|bigint|null|nonnegative",
  "ai_pricing_rules.image_output_price_microusd_per_million|bigint|null|nonnegative",
  "gateway_requests.operation|text|not-null|text,images.generations,images.edits",
  "gateway_requests.image_token_details|bigint|null|nonnegative",
  "gateway_requests.image_price_snapshots|bigint|null|nonnegative",
  "identity.runtime_delegations.gateway-cli|scope=images:create",
] as const;
const contractSha256 = createHash("sha256")
  .update(contractLines.join("\n"))
  .digest("hex");

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("gateway.images.v1 schema contract", () => {
  it("matches the server capability identity", () => {
    expect(contractSha256).toBe(
      "073808fc6d828d46266d35ee4d7649477dddddb0e8f0e40351f34d52137b4eed",
    );
    expect(imageApiPolicy.schemaCapability).toEqual({
      capability: "gateway.images.v1",
      version: 1,
      contractSha256,
    });
  });

  it("keeps source, snapshot, journal, and forward migration aligned", () => {
    const schema = source("packages/db/src/schema/index.ts");
    const authSchema = source("packages/db/src/schema/auth.ts");
    const snapshot = source("drizzle/meta/0078_snapshot.json");
    const journal = source("drizzle/meta/_journal.json");
    const migration = source("drizzle/0078_absent_puppet_master.sql");

    for (const field of [
      "image_input_token_reserve_per_image",
      "image_output_token_reserve_per_image",
      "image_input_price_microusd_per_million",
      "image_output_price_microusd_per_million",
      "input_text_tokens",
      "input_image_tokens",
      "output_text_tokens",
      "output_image_tokens",
    ]) {
      expect(schema).toContain(field);
      expect(snapshot).toContain(field);
      expect(migration).toContain(field);
    }
    expect(authSchema).toContain("'images:create'");
    expect(migration).toContain("'images:create'");
    expect(journal).toContain('"tag": "0078_absent_puppet_master"');
    expect(migration).toContain(`'${contractSha256}'`);
    expect(migration.lastIndexOf("gateway.images.v1")).toBeGreaterThan(
      migration.lastIndexOf("VALIDATE CONSTRAINT"),
    );
  });
});
