export function weekResetScope(week) {
  const normalized = Number(week);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 8) throw new Error('Ungültige Woche für den Neustart.');
  return {
    week: normalized,
    processStatus: `WEEK_${normalized}`,
    clarityPhases: normalized === 1 ? ['start'] : normalized === 4 ? ['midpoint'] : normalized === 8 ? ['end'] : [],
  };
}
