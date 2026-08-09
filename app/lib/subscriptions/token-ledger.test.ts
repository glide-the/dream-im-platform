import { describe, expect, it } from "vitest";

import { tokenLedgerSnapshot } from "./token-ledger";

describe("Token ledger conservation", () => {
  it("derives available Tokens from the immutable allowance total", () => {
    expect(
      tokenLedgerSnapshot({
        grantedTokens: 10_000,
        reservedTokens: 40,
        consumedTokens: 12,
      }),
    ).toEqual({
      availableTokens: 9_948,
      reservedTokens: 40,
      consumedTokens: 12,
    });
  });

  it("fails closed on negative or non-conserving states", () => {
    expect(() =>
      tokenLedgerSnapshot({
        grantedTokens: 10,
        reservedTokens: 8,
        consumedTokens: 3,
      }),
    ).toThrow("SUBSCRIPTION_TOKEN_LEDGER_CONSERVATION_INVALID");
    expect(() =>
      tokenLedgerSnapshot({
        grantedTokens: 10,
        reservedTokens: -1,
        consumedTokens: 0,
      }),
    ).toThrow(RangeError);
  });
});
