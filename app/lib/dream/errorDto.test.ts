// [Input] Domain revision conflict or untrusted exception-shaped metadata.
// [Output] Original product conflict feedback survives without arbitrary JSON/SQL leakage.
// [Pos] Provider-free error contract tests.
import { describe, expect, it } from "vitest";
import { projectDomainErrorDetails } from "./errorDto";
describe("closed domain error details", () => {
  it("preserves current Draft/latest Version feedback", () => {
    expect(projectDomainErrorDetails("DECK_VERSION_CONFLICT", { current_draft_revision: 8, current_version: 2 })).toEqual({ current_draft_revision: 8, current_version: 2 });
  });
  it("preserves only named existing Deck deletion reasons", () => {
    expect(projectDomainErrorDetails("DECK_DELETE_BLOCKED", { reason: "runtime_history" })).toEqual({ reason: "runtime_history" });
    expect(projectDomainErrorDetails("DECK_DELETE_BLOCKED", { reason: "unknown" })).toBeUndefined();
    expect(projectDomainErrorDetails("DECK_DELETE_BLOCKED", { reason: "child_decks", sql: "secret" })).toBeUndefined();
  });
  it("drops unknown/extra/unsafe metadata", () => {
    expect(projectDomainErrorDetails("UNKNOWN", { sql: "secret" })).toBeUndefined();
    expect(projectDomainErrorDetails("DECK_VERSION_CONFLICT", { current_draft_revision: 8, current_version: null, sql: "secret" })).toBeUndefined();
    expect(projectDomainErrorDetails("DECK_VERSION_CONFLICT", { current_draft_revision: Number.MAX_SAFE_INTEGER + 1, current_version: null })).toBeUndefined();
  });
});
