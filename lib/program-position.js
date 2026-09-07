import { isOnboardingComplete, PROGRAM_WEEKS, reconcileProgramPosition } from './program-access.js';
import { weekOneComplete } from './week-one.js';
import { guidedWeekComplete, normalizeGuidedWeekState } from './guided-weeks.js';

function latestProgramEntries(entries = []) {
  const latest = new Map();
  [...entries]
    .sort((left, right) => new Date(right?.created_at || 0) - new Date(left?.created_at || 0))
    .forEach((entry) => {
      const week = Number(entry?.week);
      if (!PROGRAM_WEEKS.includes(week) || latest.has(week) || entry?.data_block !== `week_${week}_state`) return;
      const state = entry?.structured_data?.[`week_${week}`];
      if (state && typeof state === 'object') latest.set(week, entry);
    });
  return latest;
}

export function latestProgramStateEntries(entries = []) {
  return new Map([...latestProgramEntries(entries)].map(([week, entry]) => [week, entry.structured_data[`week_${week}`]]));
}

function explicitlyCompleted(state = {}) {
  return state.status === 'completed' && Boolean(state.completed_at);
}

function berlinDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function completionTimestampValid(entry, state, unlocksAt, evaluatedAt) {
  const completedAt = new Date(state.completed_at);
  const createdAt = new Date(entry.created_at);
  const evaluated = new Date(evaluatedAt);
  if ([completedAt, createdAt, evaluated].some((date) => Number.isNaN(date.getTime()))) return false;
  if (completedAt > evaluated || createdAt > evaluated) return false;
  if (!unlocksAt) return false;
  return berlinDate(completedAt) >= unlocksAt && berlinDate(createdAt) >= unlocksAt;
}

export function verifiedCompletedWeeksFromEntries({ progress = {}, entries = [], eligibleWeeks = PROGRAM_WEEKS, weekStates = [], evaluatedAt = new Date().toISOString() } = {}) {
  if (!isOnboardingComplete(progress)) return [];
  const eligible = new Set(eligibleWeeks.map(Number));
  const latest = latestProgramEntries(entries);
  const releaseByWeek = new Map(weekStates.map((state) => [Number(state.week), state.unlocksAt]));
  const preconditions = { privacyConsent: Boolean(progress.privacy_consent_at), startCommitment: Boolean(progress.start_commitment_at) };
  return PROGRAM_WEEKS.filter((week) => {
    if (!eligible.has(week)) return false;
    const entry = latest.get(week);
    const state = entry?.structured_data?.[`week_${week}`];
    if (!explicitlyCompleted(state)) return false;
    if (!completionTimestampValid(entry, state, releaseByWeek.get(week), evaluatedAt)) return false;
    return week === 1 ? weekOneComplete(state, preconditions) : guidedWeekComplete(normalizeGuidedWeekState(week, state));
  });
}

export function reconcileAccessFromEntries({ access = {}, progress = {}, entries = [] } = {}) {
  if (!isOnboardingComplete(progress)) return access;
  const verifiedCompletedWeeks = verifiedCompletedWeeksFromEntries({
    progress,
    entries,
    eligibleWeeks: access.automaticUnlockedWeeks || [],
    weekStates: access.weekStates || [],
    evaluatedAt: access.evaluatedAt,
  });
  return reconcileProgramPosition(access, verifiedCompletedWeeks);
}

export function canonicalProgressPatch(access = {}, progress = {}) {
  if (!isOnboardingComplete(progress)) return null;
  const currentWeek = Number(access.processWeek) || 1;
  const processStatus = access.completedWeeks?.length === 8 ? 'FINAL_REPORT' : `WEEK_${currentWeek}`;
  if (Number(progress.current_week) === currentWeek && progress.process_status === processStatus) return null;
  return { current_week: currentWeek, process_status: processStatus };
}
