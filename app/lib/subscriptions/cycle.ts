function assertBoundaryNumber(boundaryNumber: number) {
  if (!Number.isSafeInteger(boundaryNumber) || boundaryNumber < 0) {
    throw new RangeError("boundaryNumber must be a non-negative safe integer");
  }
}

function assertValidAnchor(anchor: Date) {
  if (Number.isNaN(anchor.getTime())) {
    throw new RangeError("anchor must be a valid Date");
  }
}

/**
 * Returns a monthly boundary relative to the immutable UTC cycle anchor.
 *
 * Every boundary is calculated from the original anchor rather than the
 * previous boundary. This preserves month-end intent: Jan 31 -> Feb 28 ->
 * Mar 31 instead of drifting permanently to the 28th.
 */
export function monthlyCycleBoundary(
  anchor: Date,
  boundaryNumber: number,
): Date {
  assertValidAnchor(anchor);
  assertBoundaryNumber(boundaryNumber);

  const absoluteMonth = anchor.getUTCMonth() + boundaryNumber;
  const targetYear = anchor.getUTCFullYear() + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(anchor.getUTCDate(), lastTargetDay);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

export function monthlyCyclePeriod(
  anchor: Date,
  periodNumber: number,
): { start: Date; end: Date } {
  assertBoundaryNumber(periodNumber);
  return {
    start: monthlyCycleBoundary(anchor, periodNumber),
    end: monthlyCycleBoundary(anchor, periodNumber + 1),
  };
}

/**
 * Finds the user-specific monthly period containing `at`.
 *
 * A delayed renewal uses this to skip expired periods without retroactively
 * granting their Token allowance.
 */
export function monthlyCyclePeriodAt(
  anchor: Date,
  at: Date,
): { periodNumber: number; start: Date; end: Date } {
  assertValidAnchor(anchor);
  assertValidAnchor(at);
  if (at < anchor) {
    throw new RangeError("at must not be before the cycle anchor");
  }

  let periodNumber =
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - anchor.getUTCMonth());
  assertBoundaryNumber(periodNumber);

  while (
    periodNumber > 0 &&
    monthlyCycleBoundary(anchor, periodNumber) > at
  ) {
    periodNumber -= 1;
  }
  while (monthlyCycleBoundary(anchor, periodNumber + 1) <= at) {
    periodNumber += 1;
    assertBoundaryNumber(periodNumber);
  }

  return {
    periodNumber,
    ...monthlyCyclePeriod(anchor, periodNumber),
  };
}
