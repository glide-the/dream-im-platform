import { describe, expect, it } from "vitest";
import {
  creditAccount,
  InsufficientBalanceError,
  reserveAccount,
  settleAccount,
} from "./accounting";

const account = {
  availableMicrousd: 100_000,
  reservedMicrousd: 20_000,
  lifetimeDebitedMicrousd: 5_000,
};

describe("accounting transitions", () => {
  it("moves available funds into reserved funds", () => {
    expect(reserveAccount(account, 30_000)).toEqual({
      before: account,
      amountMicrousd: 30_000,
      after: {
        availableMicrousd: 70_000,
        reservedMicrousd: 50_000,
        lifetimeDebitedMicrousd: 5_000,
      },
    });
  });

  it("rejects a reservation before an upstream call can be made", () => {
    expect(() => reserveAccount(account, 100_001)).toThrow(
      InsufficientBalanceError,
    );
  });

  it("captures actual cost and releases unused reservation", () => {
    const result = settleAccount(account, 20_000, 12_000);
    expect(result.capture?.after).toEqual({
      availableMicrousd: 100_000,
      reservedMicrousd: 8_000,
      lifetimeDebitedMicrousd: 17_000,
    });
    expect(result.release?.after).toEqual({
      availableMicrousd: 108_000,
      reservedMicrousd: 0,
      lifetimeDebitedMicrousd: 17_000,
    });
    expect(result.final).toEqual(result.release?.after);
  });

  it("records an unexpected reservation overrun as debt", () => {
    const result = settleAccount(
      {
        availableMicrousd: 2_000,
        reservedMicrousd: 5_000,
        lifetimeDebitedMicrousd: 0,
      },
      5_000,
      9_000,
    );
    expect(result.final).toEqual({
      availableMicrousd: -2_000,
      reservedMicrousd: 0,
      lifetimeDebitedMicrousd: 9_000,
    });
    expect(result.overdraftMicrousd).toBe(2_000);
  });

  it("releases the full reservation when no usage is billable", () => {
    const result = settleAccount(account, 20_000, 0);
    expect(result.capture).toBeNull();
    expect(result.release?.amountMicrousd).toBe(20_000);
    expect(result.final).toEqual({
      availableMicrousd: 120_000,
      reservedMicrousd: 0,
      lifetimeDebitedMicrousd: 5_000,
    });
  });

  it("credits balance without mutating reserved or lifetime debit totals", () => {
    expect(creditAccount(account, 500).after).toEqual({
      availableMicrousd: 100_500,
      reservedMicrousd: 20_000,
      lifetimeDebitedMicrousd: 5_000,
    });
  });
});
