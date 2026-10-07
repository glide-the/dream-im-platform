// [Input] Fixed IANA zones, structured hourly/weekly rules and persisted next occurrences.
// [Output] Business evidence for DST, canonical recurrence, missed-run coalescing and calendar grouping.
// [Pos] Provider-free deterministic scheduled Chat time contract.
// [Sync] 2026-10-07: cover canonical hourly/weekly recurrence and persistent missed-occurrence advancement.
import { describe, expect, it } from "vitest";
import { canonicalRecurringRrule, latestDailyInstant, localDayBounds, nextDailyInstant,
  nextRecurringInstant, onceInstant, recurringDue, structuredRuleFromRrule, utcCandidates } from "./chatScheduledTaskTime";

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
  it("canonicalizes structured hourly and weekly rules without accepting arbitrary RRULE text", () => {
    expect(canonicalRecurringRrule({ kind: "hourly", interval_hours: 1, minute: 0, time_zone: "Asia/Shanghai" }))
      .toBe("FREQ=HOURLY;INTERVAL=1;BYMINUTE=0");
    expect(canonicalRecurringRrule({ kind: "weekly", weekdays: ["FR", "MO", "WE"], local_time: "09:30",
      time_zone: "Asia/Shanghai" })).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=30");
    expect(structuredRuleFromRrule("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=30", "Asia/Shanghai"))
      .toEqual({ kind: "weekly", weekdays: ["MO", "WE", "FR"], local_time: "09:30", time_zone: "Asia/Shanghai" });
    expect(() => structuredRuleFromRrule("FREQ=DAILY;BYHOUR=9", "UTC")).toThrow("SCHEDULE_RULE_INVALID");
  });
  it("starts an every-two-hours rule at the next selected minute and then advances from its persisted anchor", () => {
    const rule = "FREQ=HOURLY;INTERVAL=2;BYMINUTE=15";
    const first = nextRecurringInstant(new Date("2026-10-07T03:02:47Z"), rule, "Asia/Shanghai");
    expect(first.toISOString()).toBe("2026-10-07T03:15:00.000Z");
    expect(nextRecurringInstant(first, rule, "Asia/Shanghai").toISOString()).toBe("2026-10-07T05:15:00.000Z");
    const due = recurringDue(new Date("2026-10-07T10:00:00Z"), first.toISOString(), rule, "Asia/Shanghai");
    expect(due.scheduledAt.toISOString()).toBe("2026-10-07T09:15:00.000Z");
    expect(due.next.toISOString()).toBe("2026-10-07T11:15:00.000Z");
  });
  it("selects only configured weekdays and skips a missing DST clock occurrence", () => {
    const workdays = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0";
    expect(nextRecurringInstant(new Date("2026-10-09T14:00:00Z"), workdays, "America/New_York").toISOString())
      .toBe("2026-10-12T13:00:00.000Z");
    const sundayMissing = "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;BYHOUR=2;BYMINUTE=30";
    expect(nextRecurringInstant(new Date("2026-03-01T08:00:00Z"), sundayMissing, "America/New_York").toISOString())
      .toBe("2026-03-15T06:30:00.000Z");
  });
});
