export type AccountSnapshot = {
  availableMicrousd: number;
  reservedMicrousd: number;
  lifetimeDebitedMicrousd: number;
};

export type AccountTransition = {
  before: AccountSnapshot;
  after: AccountSnapshot;
  amountMicrousd: number;
};

function assertAmount(value: number, name: string, allowZero = false) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    throw new RangeError(
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} safe integer`,
    );
  }
}

function validateAccount(account: AccountSnapshot) {
  if (!Number.isSafeInteger(account.availableMicrousd)) {
    throw new RangeError("availableMicrousd must be a safe integer");
  }
  assertAmount(account.reservedMicrousd, "reservedMicrousd", true);
  assertAmount(
    account.lifetimeDebitedMicrousd,
    "lifetimeDebitedMicrousd",
    true,
  );
}

export class InsufficientBalanceError extends Error {
  readonly code = "INSUFFICIENT_BALANCE";

  constructor(
    public readonly availableMicrousd: number,
    public readonly requiredMicrousd: number,
  ) {
    super("Account balance is insufficient for this request");
    this.name = "InsufficientBalanceError";
  }
}

export function reserveAccount(
  account: AccountSnapshot,
  amountMicrousd: number,
): AccountTransition {
  validateAccount(account);
  assertAmount(amountMicrousd, "amountMicrousd");
  if (account.availableMicrousd < amountMicrousd) {
    throw new InsufficientBalanceError(
      account.availableMicrousd,
      amountMicrousd,
    );
  }
  const after = {
    ...account,
    availableMicrousd: account.availableMicrousd - amountMicrousd,
    reservedMicrousd: account.reservedMicrousd + amountMicrousd,
  };
  validateAccount(after);
  return {
    before: account,
    amountMicrousd,
    after,
  };
}

export function creditAccount(
  account: AccountSnapshot,
  amountMicrousd: number,
): AccountTransition {
  validateAccount(account);
  assertAmount(amountMicrousd, "amountMicrousd");
  const after = {
    ...account,
    availableMicrousd: account.availableMicrousd + amountMicrousd,
  };
  validateAccount(after);
  return {
    before: account,
    amountMicrousd,
    after,
  };
}

export type SettlementTransitions = {
  capture: AccountTransition | null;
  release: AccountTransition | null;
  final: AccountSnapshot;
  overdraftMicrousd: number;
};

/**
 * Capture actual cost and release the unused part of one request reservation.
 *
 * An unexpected charge above the reservation is still recorded as debt instead
 * of losing provider cost. The resulting negative available balance blocks all
 * subsequent reservations and is surfaced as overdraft for account suspension.
 */
export function settleAccount(
  account: AccountSnapshot,
  reservedForRequestMicrousd: number,
  chargedMicrousd: number,
): SettlementTransitions {
  validateAccount(account);
  assertAmount(
    reservedForRequestMicrousd,
    "reservedForRequestMicrousd",
    true,
  );
  assertAmount(chargedMicrousd, "chargedMicrousd", true);
  if (account.reservedMicrousd < reservedForRequestMicrousd) {
    throw new Error("ACCOUNT_RESERVED_BALANCE_INVARIANT_VIOLATION");
  }

  const capturedFromReserved = Math.min(
    chargedMicrousd,
    reservedForRequestMicrousd,
  );
  const additionalDebit = chargedMicrousd - capturedFromReserved;
  const afterCapture: AccountSnapshot = {
    availableMicrousd: account.availableMicrousd - additionalDebit,
    reservedMicrousd: account.reservedMicrousd - capturedFromReserved,
    lifetimeDebitedMicrousd:
      account.lifetimeDebitedMicrousd + chargedMicrousd,
  };
  const capture =
    chargedMicrousd > 0
      ? {
          before: account,
          after: afterCapture,
          amountMicrousd: chargedMicrousd,
        }
      : null;

  const unusedReservation =
    reservedForRequestMicrousd - capturedFromReserved;
  const afterRelease: AccountSnapshot = {
    ...afterCapture,
    availableMicrousd:
      afterCapture.availableMicrousd + unusedReservation,
    reservedMicrousd: afterCapture.reservedMicrousd - unusedReservation,
  };
  validateAccount(afterRelease);
  const release =
    unusedReservation > 0
      ? {
          before: afterCapture,
          after: afterRelease,
          amountMicrousd: unusedReservation,
        }
      : null;

  return {
    capture,
    release,
    final: afterRelease,
    overdraftMicrousd: Math.max(0, -afterRelease.availableMicrousd),
  };
}
