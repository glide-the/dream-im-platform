// [Input] Explicit local date, local clock time and fixed IANA time zone.
// [Output] Deterministic UTC candidates, daily next/most-recent instants and date projection bounds.
// [Pos] Pure scheduled Chat time rules; the browser and worker do not calculate schedule instants.
// [Sync] 2026-09-28: reject missing once instants, require an offset for ambiguous ones and skip missing daily instants.
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
