// [Input] Deck Plugin aggregate scope tuples containing separator-like and Unicode values.
// [Output] Stable collision-resistant PostgreSQL-safe advisory-lock keys.
// [Pos] Provider-free persistence-boundary regression for Registry174 write serialization.
// [Sync] 2026-09-17: prevent NUL-bearing aggregate keys from reaching PostgreSQL text parameters.
import { describe, expect, it } from "vitest";
import { deckPluginControlSerializationKey } from "./deckPluginControlRepository";

describe("Deck Plugin control serialization key", () => {
  it("is stable, PostgreSQL-safe and tuple-sensitive", () => {
    const key = deckPluginControlSerializationKey("workspace", "workspace\0one", "ink.dream.story-workflow");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("\0");
    expect(deckPluginControlSerializationKey("workspace", "workspace\0one", "ink.dream.story-workflow")).toBe(key);
    expect(deckPluginControlSerializationKey("workspace", "workspace", "one\0ink.dream.story-workflow")).not.toBe(key);
  });
});
