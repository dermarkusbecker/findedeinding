const DEFAULT_WEEK_TITLES = [
  'Ausgangslage',
  'Fähigkeiten & Umfeld',
  'Motivatoren',
  'Halbzeit',
  'Werte & Lebenswerk',
  'Dein-Ding-Map',
  'Optionen & Realität',
  'Umsetzung',
];

export function buildJourneyWeeks(program = {}) {
  const summaries = new Map(
    (Array.isArray(program?.programWeeks) ? program.programWeeks : [])
      .map((item) => [Number(item?.week), item])
      .filter(([week]) => Number.isInteger(week) && week >= 1 && week <= 8),
  );
  const states = new Map(
    (Array.isArray(program?.access?.weekStates) ? program.access.weekStates : [])
      .map((item) => [Number(item?.week), item])
      .filter(([week]) => Number.isInteger(week) && week >= 1 && week <= 8),
  );
  const completedWeeks = new Set(
    (Array.isArray(program?.access?.completedWeeks) ? program.access.completedWeeks : [])
      .map(Number)
      .filter((week) => week >= 1 && week <= 8),
  );
  const onboardingComplete = program?.onboardingComplete === true;
  const demoAccess = onboardingComplete && program?.access?.fullProgramAccess === true;

  return Array.from({ length: 8 }, (_, index) => {
    const week = index + 1;
    const summary = summaries.get(week) || { week, title: DEFAULT_WEEK_TITLES[index], mode: 'Dein Prozess', description: '' };
    const storedState = states.get(week) || {};
    const completed = storedState.completed === true || completedWeeks.has(week);
    const accessible = storedState.accessible === true || demoAccess;
    return {
      ...storedState,
      week,
      summary,
      completed,
      accessible,
      reason: storedState.reason || (demoAccess ? 'demo_full_access' : onboardingComplete ? 'not_yet_released' : 'onboarding_required'),
    };
  });
}
