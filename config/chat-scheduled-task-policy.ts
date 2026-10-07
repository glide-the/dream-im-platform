// [Input] Product once/daily/interval schedule rules and service lease capacity.
// [Output] Explicit finite search and lease policy shared by Admin scheduling services.
// [Pos] Configuration for the scheduled Chat task contract, independent of deployment labels.
// [Sync] 2026-10-07: bound interval minutes and persistent unknown-result reconciliation cadence.
export const chatScheduledTaskPolicy = Object.freeze({
  calendarSearchDays: 370,
  claimLeaseSeconds: 300,
  titleMaximumCharacters: 240,
  promptMaximumCharacters: 32_000,
  timeZoneMaximumCharacters: 128,
  historyPageMaximum: 100,
  intervalMaximumMinutes: 2_147_483_647,
  unknownRecheckSeconds: 60,
});
