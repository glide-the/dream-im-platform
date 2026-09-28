// [Input] Fixed IANA zones around missing/repeated clock times and date boundaries.
// [Output] Business evidence for once ambiguity, daily skip/earlier occurrence and calendar grouping.
// [Pos] Provider-free deterministic scheduled Chat time contract.
// [Sync] 2026-09-28: distinguish spring and autumn DST decisions without server-local time defaults.
import { describe, expect, it } from "vitest";
import { latestDailyInstant, localDayBounds, nextDailyInstant, onceInstant, utcCandidates } from "./chatScheduledTaskTime";

describe("scheduled Chat local time", () => {
  it("rejects a missing once time and requires an offset when the clock repeats", () => {
    expect(utcCandidates("2026-03-08", "02:30", "America/New_York")).toEqual([]);
    expect(() => onceInstant("2026-03-08", "02:30", "America/New_York", null)).toThrow("SCHEDULE_LOCAL_TIME_MISSING");
    expect(() => onceInstant("2026-11-01", "01:30", "America/New_York", null)).toThrow("SCHEDULE_OFFSET_REQUIRED");
    expect(onceInstant("2026-11-01", "01:30", "America/New_York", -240).instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(onceInstant("2026-11-01", "01:30", "America/New_York", -300).instant.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(() => onceInstant("2026-11-01", "01:30", "America/New_York", -360)).toThrow("SCHEDULE_OFFSET_INVALID");
  });
  it("skips a missing daily time and uses only the first repeated occurrence", () => {
    expect(nextDailyInstant(new Date("2026-03-07T08:00:00Z"), "02:30", "America/New_York").toISOString()).toBe("2026-03-09T06:30:00.000Z");
    expect(latestDailyInstant(new Date("2026-11-01T06:45:00Z"), "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(nextDailyInstant(new Date("2026-11-01T05:31:00Z"), "01:30", "America/New_York").toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
  it("projects a 23-hour calendar day using its display zone", () => {
    const bounds = localDayBounds("2026-03-08", "America/New_York");
    expect(bounds.from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(bounds.until.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(() => localDayBounds("2026-02-30", "UTC")).toThrow("SCHEDULE_DATE_INVALID");
  });
});
