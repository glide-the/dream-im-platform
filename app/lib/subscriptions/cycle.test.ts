import { describe, expect, it } from "vitest";
import {
  monthlyCycleBoundary,
  monthlyCyclePeriod,
  monthlyCyclePeriodAt,
} from "./cycle";

describe("monthly subscription cycle boundaries", () => {
  it("calculates ordinary monthly periods from the immutable anchor", () => {
    const anchor = new Date("2026-05-15T08:30:45.123Z");

    expect(monthlyCyclePeriod(anchor, 2)).toEqual({
      start: new Date("2026-07-15T08:30:45.123Z"),
      end: new Date("2026-08-15T08:30:45.123Z"),
    });
    expect(anchor.toISOString()).toBe("2026-05-15T08:30:45.123Z");
  });

  it("does not drift after clamping a month-end boundary", () => {
    const anchor = new Date("2025-01-31T10:00:00.000Z");

    expect(monthlyCycleBoundary(anchor, 1).toISOString()).toBe(
      "2025-02-28T10:00:00.000Z",
    );
    expect(monthlyCycleBoundary(anchor, 2).toISOString()).toBe(
      "2025-03-31T10:00:00.000Z",
    );
  });

  it("uses the leap-day boundary when the target February supports it", () => {
    const anchor = new Date("2024-01-31T23:59:59.999Z");

    expect(monthlyCycleBoundary(anchor, 1).toISOString()).toBe(
      "2024-02-29T23:59:59.999Z",
    );
    expect(monthlyCycleBoundary(anchor, 13).toISOString()).toBe(
      "2025-02-28T23:59:59.999Z",
    );
  });

  it("uses the represented UTC instant rather than the source offset", () => {
    const anchor = new Date("2026-01-31T23:30:00.000-08:00");

    expect(anchor.toISOString()).toBe("2026-02-01T07:30:00.000Z");
    expect(monthlyCycleBoundary(anchor, 1).toISOString()).toBe(
      "2026-03-01T07:30:00.000Z",
    );
  });

  it("rejects invalid anchors and negative period numbers", () => {
    expect(() => monthlyCycleBoundary(new Date("invalid"), 0)).toThrow(
      RangeError,
    );
    expect(() => monthlyCyclePeriod(new Date("2026-01-01T00:00:00Z"), -1))
      .toThrow(RangeError);
  });

  it("finds the current anchored period after multiple missed boundaries", () => {
    const anchor = new Date("2026-01-31T08:15:30.000Z");

    expect(
      monthlyCyclePeriodAt(anchor, new Date("2026-05-15T00:00:00.000Z")),
    ).toEqual({
      periodNumber: 3,
      start: new Date("2026-04-30T08:15:30.000Z"),
      end: new Date("2026-05-31T08:15:30.000Z"),
    });
  });

  it("treats an exact boundary as the start of the next period", () => {
    const anchor = new Date("2024-01-31T08:00:00.000Z");

    expect(
      monthlyCyclePeriodAt(anchor, new Date("2024-02-29T08:00:00.000Z")),
    ).toEqual({
      periodNumber: 1,
      start: new Date("2024-02-29T08:00:00.000Z"),
      end: new Date("2024-03-31T08:00:00.000Z"),
    });
  });
});
