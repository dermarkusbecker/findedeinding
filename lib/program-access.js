export const ACCESS_MODES = Object.freeze({
  COMPLETION: 'completion_based',
  TIME: 'time_based',
  FULL: 'full_access',
});

export const PROGRAM_STATUSES = Object.freeze({ ACTIVE: 'active', PAUSED: 'paused' });
export const PROGRAM_WEEKS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

const validMode = (mode) => Object.values(ACCESS_MODES).includes(mode) ? mode : ACCESS_MODES.TIME;
const weekArray = (value) => [...new Set((Array.isArray(value) ? value : []).map(Number).filter((week) => PROGRAM_WEEKS.includes(week)))].sort((a, b) => a - b);

const dateAtDayOffset = (dateString, days) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return null;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export function programWeekSchedule(programStartDate) {
  if (!dateAtDayOffset(programStartDate, 0)) return [];
  return PROGRAM_WEEKS.map((week) => ({
    week,
    unlocksAt: dateAtDayOffset(programStartDate, (week - 1) * 7),
    endsAt: dateAtDayOffset(programStartDate, week * 7),
  }));
}

function completedWeeksFromGates(gates) {
  return PROGRAM_WEEKS.filter((week) => {
    const required = gates.filter((gate) => Number(gate.week) === week && gate.required !== false);
    return required.length > 0 && required.every((gate) => Boolean(gate.completed_at));
  });
}

function completionUnlockedWeeks(completedWeeks) {
  const completed = new Set(completedWeeks);
  const unlocked = [1];
  for (let week = 2; week <= 8; week += 1) {
    if (!completed.has(week - 1)) break;
    unlocked.push(week);
  }
  return unlocked;
}

function timeUnlockedWeeks(programStartDate, now) {
  if (!programStartDate) return [];
  const start = new Date(`${programStartDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return [];
  const berlinDateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const datePart = (type) => berlinDateParts.find((part) => part.type === type)?.value;
  const currentDate = new Date(`${datePart('year')}-${datePart('month')}-${datePart('day')}T00:00:00.000Z`);
  const elapsedDays = Math.floor((currentDate.getTime() - start.getTime()) / 86400000);
  if (elapsedDays < 0) return [];
  return PROGRAM_WEEKS.slice(0, Math.min(8, Math.floor(elapsedDays / 7) + 1));
}

export function isOnboardingComplete(progress = {}) {
  const privacyConsent = Boolean(progress.privacy_consent_at);
  const startCommitment = Boolean(progress.start_commitment_at);
  // Die getrennt protokollierten Start-Gates sind die belastbare Quelle.
  // Legacy-Datensätze können trotz erfolgreichem Start noch einen veralteten
  // process_status oder current_week enthalten und dürfen nicht zurückfallen.
  return privacyConsent && startCommitment;
}

export function resetParticipantProgressState() {
  return {
    current_week: 0,
    process_status: 'ONBOARDING',
    program_status: PROGRAM_STATUSES.ACTIVE,
    access_mode: ACCESS_MODES.TIME,
    manually_unlocked_weeks: [],
    manually_locked_weeks: [],
    privacy_consent_at: null,
    start_commitment_at: null,
    final_commitment_at: null,
    last_activity_at: null,
  };
}

export function reopenWeekState(week = 1) {
  const normalized = Number(week);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 8) {
    return {
      current_week: 0,
      process_status: 'ONBOARDING',
      program_status: PROGRAM_STATUSES.ACTIVE,
      access_mode: ACCESS_MODES.TIME,
      last_activity_at: null,
    };
  }
  return {
    current_week: normalized,
    process_status: `WEEK_${normalized}`,
    program_status: PROGRAM_STATUSES.ACTIVE,
    access_mode: ACCESS_MODES.TIME,
    last_activity_at: null,
  };
}

export function calculateProgramAccess({ profileStatus = 'active', progress = {}, gates = [], now = new Date() } = {}) {
  const accessMode = validMode(progress.access_mode);
  const programStatus = profileStatus === 'paused' || progress.program_status === PROGRAM_STATUSES.PAUSED ? PROGRAM_STATUSES.PAUSED : PROGRAM_STATUSES.ACTIVE;
  const manuallyUnlockedWeeks = weekArray(progress.manually_unlocked_weeks);
  const manuallyLockedWeeks = weekArray(progress.manually_locked_weeks);
  const unlockedOverrides = new Set(manuallyUnlockedWeeks);
  const lockedOverrides = new Set(manuallyLockedWeeks);
  const completedWeeks = completedWeeksFromGates(gates);
  const schedule = programWeekSchedule(progress.program_start_date);
  const scheduleByWeek = new Map(schedule.map((item) => [item.week, item]));

  let automaticUnlockedWeeks = [];
  if (accessMode === ACCESS_MODES.FULL) automaticUnlockedWeeks = [...PROGRAM_WEEKS];
  else if (accessMode === ACCESS_MODES.COMPLETION) automaticUnlockedWeeks = completionUnlockedWeeks(completedWeeks);
  else if (accessMode === ACCESS_MODES.TIME) automaticUnlockedWeeks = timeUnlockedWeeks(progress.program_start_date, now);
  const automatic = new Set(automaticUnlockedWeeks);

  const weekStates = PROGRAM_WEEKS.map((week) => {
    let accessible = false;
    let reason = 'denied';
    if (programStatus !== PROGRAM_STATUSES.ACTIVE) reason = 'participant_paused';
    else if (lockedOverrides.has(week)) reason = 'admin_locked';
    else if (unlockedOverrides.has(week)) { accessible = true; reason = 'admin_unlocked'; }
    else if (accessMode === ACCESS_MODES.FULL) { accessible = true; reason = 'full_access'; }
    else if (accessMode === ACCESS_MODES.COMPLETION && automatic.has(week)) { accessible = true; reason = week === 1 ? 'program_start' : 'previous_week_completed'; }
    else if (accessMode === ACCESS_MODES.TIME && automatic.has(week)) { accessible = true; reason = 'scheduled_release'; }
    else if (accessMode === ACCESS_MODES.TIME && scheduleByWeek.has(week)) reason = 'scheduled_wait';
    return { week, accessible, completed: completedWeeks.includes(week), reason, adminOverride: lockedOverrides.has(week) ? 'locked' : unlockedOverrides.has(week) ? 'unlocked' : null, ...(scheduleByWeek.get(week) || {}) };
  });
  const unlockedWeeks = weekStates.filter((state) => state.accessible).map((state) => state.week);
  const currentWeek = unlockedWeeks.at(-1) || 0;

  return {
    accessMode,
    programStartDate: progress.program_start_date || null,
    programEndDate: schedule.at(-1)?.endsAt || null,
    status: programStatus,
    currentWeek,
    recordedCurrentWeek: Number(progress.current_week) || 0,
    unlockedWeeks,
    automaticUnlockedWeeks,
    manuallyUnlockedWeeks,
    manuallyLockedWeeks,
    completedWeeks,
    weekStates,
    canAccessWeek: (week) => weekStates.some((state) => state.week === Number(week) && state.accessible),
  };
}

export function serializeProgramAccess(access) {
  const { canAccessWeek, ...serializable } = access;
  return serializable;
}
