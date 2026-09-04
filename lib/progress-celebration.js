const validScore = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;

export function buildProgressCelebration({
  activeWeek = 1,
  completedWeeks = [],
  clarityHistory = [],
  completedSteps = 0,
  totalSteps = 0,
  currentWeekTitle = 'Dein nächster Schritt',
  onboardingComplete = false,
} = {}) {
  const finishedWeeks = [...new Set(completedWeeks.map(Number).filter((week) => week >= 1 && week <= 8))];
  const measurements = clarityHistory.filter((item) => validScore(item?.score));
  const firstScore = measurements.length ? Number(measurements[0].score) : null;
  const currentScore = measurements.length ? Number(measurements.at(-1).score) : null;
  const clarityGain = firstScore !== null && currentScore !== null ? currentScore - firstScore : 0;
  const week = Math.min(8, Math.max(1, Number(activeWeek) || 1));
  const percent = Math.round(finishedWeeks.length / 8 * 100);
  const isComplete = finishedWeeks.length === 8;
  const safeCompletedSteps = Math.max(0, Number(completedSteps) || 0);
  const safeTotalSteps = Math.max(safeCompletedSteps, Number(totalSteps) || 0);

  let title = 'Der wichtigste Schritt ist gemacht.';
  let praise = onboardingComplete
    ? 'Du hast dich bewusst auf deinen Weg eingelassen. Das ist die Grundlage für echte Veränderung.'
    : 'Du bereitest gerade deinen persönlichen Start vor. Schon diese Entscheidung verdient Anerkennung.';
  let claraTitle = 'Dein Weg hat begonnen.';
  let claraCopy = `Bleib neugierig und geh Schritt für Schritt weiter. Als Nächstes wartet „${currentWeekTitle}“ auf dich.`;

  if (safeCompletedSteps > 0 && !finishedWeeks.includes(week)) {
    title = 'Du bist mittendrin – und bleibst dran.';
    praise = `Du hast in Woche ${week} bereits ${safeCompletedSteps} von ${safeTotalSteps || safeCompletedSteps} Schritten geschafft. Das ist sichtbarer Fortschritt.`;
    claraTitle = 'Genau dieses Dranbleiben zählt.';
    claraCopy = `Du musst nicht alles auf einmal lösen. Nimm dir jetzt den nächsten Schritt in „${currentWeekTitle}“ vor – ich begleite dich dabei.`;
  }

  if (finishedWeeks.length > 0) {
    const noun = finishedWeeks.length === 1 ? 'Woche' : 'Wochen';
    title = finishedWeeks.length >= 4 ? 'Du hast schon richtig viel bewegt.' : 'Dein Fortschritt wird sichtbar.';
    praise = `${finishedWeeks.length} ${noun} hast du bewusst abgeschlossen. Du sammelst nicht nur Gedanken, sondern machst daraus Schritt für Schritt deinen Weg.`;
    claraTitle = finishedWeeks.length >= 4 ? 'Darauf darfst du wirklich stolz sein.' : 'Das darfst du dir anrechnen.';
    claraCopy = `Nimm diesen Erfolg kurz wahr – und dann geht es mit „${currentWeekTitle}“ weiter. Genau dort wartet deine nächste Erkenntnis.`;
  }

  if (clarityGain > 0) {
    title = 'Deine Klarheit wächst.';
    praise = `Du bist bei ${firstScore} gestartet und stehst jetzt bei ${currentScore} von 10 – ein Plus von ${clarityGain} ${clarityGain === 1 ? 'Punkt' : 'Punkten'}. Deine Entwicklung ist messbar.`;
    claraTitle = 'Siehst du, was du schon bewegt hast?';
    claraCopy = `Diese Klarheit ist durch deine ehrliche Arbeit entstanden. Bleib dran und geh jetzt mutig weiter in „${currentWeekTitle}“ – der nächste Schritt muss nicht perfekt sein, nur echt.`;
  }

  if (isComplete) {
    title = 'Acht Wochen. Dein Weg. Geschafft.';
    praise = currentScore === null
      ? 'Du hast alle acht Wochen abgeschlossen und bist deinen Weg konsequent bis zum Ende gegangen.'
      : `Du hast alle acht Wochen abgeschlossen und deinen letzten Klarheitswert bei ${currentScore} von 10 festgehalten.`;
    claraTitle = 'Was für eine Entwicklung.';
    claraCopy = 'Du hast dir selbst zugehört, Entscheidungen geprüft und Verantwortung übernommen. Feiere diesen Moment – und nimm deine Erkenntnisse jetzt mit ins echte Leben.';
  }

  return {
    week,
    percent,
    completedWeeks: finishedWeeks.length,
    currentScore,
    completedSteps: safeCompletedSteps,
    totalSteps: safeTotalSteps,
    title,
    praise,
    claraTitle,
    claraCopy,
    ctaLabel: isComplete ? 'Meine Entwicklung ansehen →' : `In Woche ${week} weitermachen →`,
    isComplete,
  };
}
