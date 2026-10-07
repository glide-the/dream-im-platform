// [Input] Explicit local date/clock/IANA zone plus structured hourly/weekly recurrence.
// [Output] Deterministic UTC candidates, canonical recurrence, next/due instants and date projection bounds.
// [Pos] Pure scheduled Chat time rules; the browser and worker do not calculate schedule instants.
// [Sync] 2026-10-07: add Admin-owned canonical hourly/weekly RRULE projection and persistent due advancement.
import { chatScheduledTaskPolicy } from "../../../config/chat-scheduled-task-policy";
import { AuthBoundaryError } from "../auth/config";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let current = formatters.get(timeZone);
  if (current) return current;
  try {
    current = new Intl.DateTimeFormat("en-US-u-nu-latn", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    current.format(0);
  } catch { throw new AuthBoundaryError("SCHEDULE_TIME_ZONE_INVALID", 400); }
  formatters.set(timeZone, current);
  return current;
}
function dateMillis(localDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new AuthBoundaryError("SCHEDULE_DATE_INVALID", 400);
  const [year, month, day] = localDate.split("-").map(Number);
  const instant = Date.UTC(year, month - 1, day);
  if (new Date(instant).toISOString().slice(0, 10) !== localDate) throw new AuthBoundaryError("SCHEDULE_DATE_INVALID", 400);
  return instant;
}
function clock(localTime: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new AuthBoundaryError("SCHEDULE_TIME_INVALID", 400);
  const [hour, minute] = localTime.split(":").map(Number);
  return hour * 60 + minute;
}
export function addLocalDays(localDate: string, days: number) {
  return new Date(dateMillis(localDate) + days * 86_400_000).toISOString().slice(0, 10);
}
export function localDateAt(instant: Date, timeZone: string) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function localMinuteKey(instant: Date, timeZone: string) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
function offsetMinutes(instant: Date, timeZone: string) {
  const local = localMinuteKey(instant, timeZone);
  return (Date.parse(`${local}:00Z`) - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000;
}
export function utcCandidates(localDate: string, localTime: string, timeZone: string) {
  const base = dateMillis(localDate) + clock(localTime) * 60_000;
  const wanted = `${localDate}T${localTime}`;
  const offsets = new Set([-36, -12, 0, 12, 36].map(hours => offsetMinutes(new Date(base + hours * 3_600_000), timeZone)));
  return [...offsets].map(offset => ({ offsetMinutes: offset, instant: new Date(base - offset * 60_000) }))
    .filter(value => localMinuteKey(value.instant, timeZone) === wanted)
    .sort((a, b) => a.instant.getTime() - b.instant.getTime());
}
export function onceInstant(localDate: string, localTime: string, timeZone: string, selectedOffset: number | null) {
  const candidates = utcCandidates(localDate, localTime, timeZone);
  if (!candidates.length) throw new AuthBoundaryError("SCHEDULE_LOCAL_TIME_MISSING", 400);
  if (candidates.length > 1 && selectedOffset === null) throw new AuthBoundaryError("SCHEDULE_OFFSET_REQUIRED", 400);
  const chosen = selectedOffset === null ? candidates[0] : candidates.find(item => item.offsetMinutes === selectedOffset);
  if (!chosen) throw new AuthBoundaryError("SCHEDULE_OFFSET_INVALID", 400);
  return chosen;
}
export function nextDailyInstant(after: Date, localTime: string, timeZone: string) {
  const first = localDateAt(after, timeZone);
  for (let day = 0; day < chatScheduledTaskPolicy.calendarSearchDays; day++) {
    const candidate = utcCandidates(addLocalDays(first, day), localTime, timeZone)[0]?.instant;
    if (candidate && candidate > after) return candidate;
  }
  throw new AuthBoundaryError("SCHEDULE_TIME_UNAVAILABLE");
}
export function latestDailyInstant(before: Date, localTime: string, timeZone: string) {
  const first = localDateAt(before, timeZone);
  for (let day = 0; day < chatScheduledTaskPolicy.calendarSearchDays; day++) {
    const candidate = utcCandidates(addLocalDays(first, -day), localTime, timeZone)[0]?.instant;
    if (candidate && candidate <= before) return candidate;
  }
  throw new AuthBoundaryError("SCHEDULE_TIME_UNAVAILABLE");
}
export function localDayBounds(localDate: string, displayTimeZone: string) {
  function start(date: string) {
    const anchor = dateMillis(date);
    let low = Math.floor((anchor - 48 * 3_600_000) / 60_000);
    let high = Math.ceil((anchor + 48 * 3_600_000) / 60_000);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (localDateAt(new Date(middle * 60_000), displayTimeZone) < date) low = middle + 1;
      else high = middle;
    }
    const result = new Date(low * 60_000);
    if (localDateAt(result, displayTimeZone) !== date) throw new AuthBoundaryError("SCHEDULE_DATE_UNAVAILABLE", 400);
    return result;
  }
  return { from: start(localDate), until: start(addLocalDays(localDate, 1)) };
}

export const scheduledWeekdays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type ScheduledWeekday = typeof scheduledWeekdays[number];
const weekdayOrder = new Map<ScheduledWeekday, number>(scheduledWeekdays.map((value, index) => [value, index]));
const javascriptWeekday: Record<number, ScheduledWeekday> = { 0: "SU", 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA" };

export type StructuredRecurringRule =
  | { kind: "hourly"; interval_hours: number; minute: number; time_zone: string }
  | { kind: "weekly"; weekdays: ScheduledWeekday[]; local_time: string; time_zone: string };

type ParsedRecurringRule =
  | { frequency: "HOURLY"; interval: number; minute: number }
  | { frequency: "WEEKLY"; interval: 1; weekdays: ScheduledWeekday[]; localTime: string };

function recurringError(): never { throw new AuthBoundaryError("SCHEDULE_RULE_INVALID", 400); }

export function canonicalRecurringRrule(rule: StructuredRecurringRule) {
  formatter(rule.time_zone);
  if (rule.kind === "hourly") {
    if (!Number.isSafeInteger(rule.interval_hours) || rule.interval_hours < 1
      || !Number.isInteger(rule.minute) || rule.minute < 0 || rule.minute > 59) recurringError();
    return `FREQ=HOURLY;INTERVAL=${rule.interval_hours};BYMINUTE=${rule.minute}`;
  }
  clock(rule.local_time);
  const unique = [...new Set(rule.weekdays)];
  if (!unique.length || unique.length !== rule.weekdays.length || unique.some(value => !weekdayOrder.has(value))) recurringError();
  unique.sort((left, right) => weekdayOrder.get(left)! - weekdayOrder.get(right)!);
  const [hour, minute] = rule.local_time.split(":").map(Number);
  return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${unique.join(",")};BYHOUR=${hour};BYMINUTE=${minute}`;
}

export function parseRecurringRrule(value: string): ParsedRecurringRule {
  const properties = new Map<string, string>();
  for (const segment of value.trim().split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0 || separator === segment.length - 1) recurringError();
    const key = segment.slice(0, separator).toUpperCase();
    if (properties.has(key)) recurringError();
    properties.set(key, segment.slice(separator + 1).toUpperCase());
  }
  const frequency = properties.get("FREQ");
  const allowed = frequency === "HOURLY" ? new Set(["FREQ", "INTERVAL", "BYMINUTE"])
    : frequency === "WEEKLY" ? new Set(["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE"])
      : null;
  if (!allowed || [...properties.keys()].some(key => !allowed.has(key))) recurringError();
  const interval = Number(properties.get("INTERVAL") ?? "1");
  if (!Number.isSafeInteger(interval) || interval < 1) recurringError();
  if (frequency === "HOURLY") {
    const minute = Number(properties.get("BYMINUTE"));
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) recurringError();
    return { frequency: "HOURLY", interval, minute };
  }
  if (interval !== 1) recurringError();
  const weekdays = (properties.get("BYDAY") ?? "").split(",") as ScheduledWeekday[];
  if (!weekdays.length || new Set(weekdays).size !== weekdays.length || weekdays.some(value => !weekdayOrder.has(value))) recurringError();
  const hour = Number(properties.get("BYHOUR"));
  const minute = Number(properties.get("BYMINUTE"));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) recurringError();
  return { frequency: "WEEKLY", interval: 1, weekdays, localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function structuredRuleFromRrule(rrule: string, timeZone: string): StructuredRecurringRule {
  formatter(timeZone);
  const parsed = parseRecurringRrule(rrule);
  return parsed.frequency === "HOURLY"
    ? { kind: "hourly", interval_hours: parsed.interval, minute: parsed.minute, time_zone: timeZone }
    : { kind: "weekly", weekdays: parsed.weekdays, local_time: parsed.localTime, time_zone: timeZone };
}

function localMinute(instant: Date, timeZone: string) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
  return Number(values.minute);
}

export function nextRecurringInstant(after: Date, rrule: string, timeZone: string) {
  const parsed = parseRecurringRrule(rrule);
  formatter(timeZone);
  if (parsed.frequency === "HOURLY") {
    if (parsed.interval > 1 && localMinute(after, timeZone) === parsed.minute
      && after.getUTCSeconds() === 0 && after.getUTCMilliseconds() === 0) {
      return new Date(after.getTime() + parsed.interval * 3_600_000);
    }
    let candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
    for (let minute = 0; minute < 26 * 60; minute++, candidate = new Date(candidate.getTime() + 60_000)) {
      if (localMinute(candidate, timeZone) === parsed.minute) return candidate;
    }
    throw new AuthBoundaryError("SCHEDULE_TIME_UNAVAILABLE");
  }
  const first = localDateAt(after, timeZone);
  for (let day = 0; day < chatScheduledTaskPolicy.calendarSearchDays; day++) {
    const localDate = addLocalDays(first, day);
    const weekday = javascriptWeekday[new Date(`${localDate}T00:00:00Z`).getUTCDay()];
    if (!parsed.weekdays.includes(weekday)) continue;
    const candidate = utcCandidates(localDate, parsed.localTime, timeZone)[0]?.instant;
    if (candidate && candidate > after) return candidate;
  }
  throw new AuthBoundaryError("SCHEDULE_TIME_UNAVAILABLE");
}

export function recurringDue(now: Date, persistedNext: string, rrule: string, timeZone: string) {
  let scheduledAt = new Date(persistedNext);
  if (!Number.isFinite(scheduledAt.getTime())) recurringError();
  let next = nextRecurringInstant(scheduledAt, rrule, timeZone);
  let steps = 0;
  while (next <= now) {
    scheduledAt = next;
    next = nextRecurringInstant(scheduledAt, rrule, timeZone);
    if (++steps > 100_000) throw new AuthBoundaryError("SCHEDULE_TIME_UNAVAILABLE");
  }
  return { scheduledAt, next };
}
