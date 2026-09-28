// [Input] Product once/daily schedule rules and service lease capacity.
// [Output] Explicit finite search and lease policy shared by Admin scheduling services.
// [Pos] Configuration for the scheduled Chat task contract, independent of deployment labels.
// [Sync] 2026-09-28: define bounded IANA date search and short service claim lifetime.
export const chatScheduledTaskPolicy = Object.freeze({
  calendarSearchDays: 370,
  claimLeaseSeconds: 300,
  titleMaximumCharacters: 240,
  promptMaximumCharacters: 32_000,
  timeZoneMaximumCharacters: 128,
  historyPageMaximum: 100,
});
