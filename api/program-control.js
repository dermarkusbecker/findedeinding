import crypto from 'node:crypto';
import { requireCurrentAdmin } from '../lib/user-auth.js';
import { PROGRAM_STATUSES } from '../lib/program-access.js';
import { getParticipantProgramAccess, isUuid, patchParticipantProgress, serviceHeaders } from '../lib/program-access-service.js';
import { applyGuidedWeekAction, currentGuidedStep, guidedGateStatus, guidedWeekDefinition, normalizeGuidedWeekState } from '../lib/guided-weeks.js';
import { weekOnePrompt } from '../lib/week-one.js';

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

async function patchCustomerProfile(service, participantId, input) {
  const changes = {
    name: clean(input?.name, 160),
    birth_date: validDate(input?.birthDate) ? input.birthDate : null,
    street: clean(input?.street, 200) || null,
    postal_code: clean(input?.postalCode, 20) || null,
    city: clean(input?.city, 120) || null,
    country: clean(input?.country, 80) || 'Deutschland',
    phone: clean(input?.phone, 40) || null,
    mobile_phone: clean(input?.mobilePhone, 40) || null,
    whatsapp_same_as_mobile: input?.whatsappSameAsMobile === true,
    whatsapp_phone: input?.whatsappSameAsMobile === true ? (clean(input?.mobilePhone, 40) || null) : (clean(input?.whatsappPhone, 40) || null),
    preferred_communication_channel: ['email', 'phone', 'whatsapp'].includes(input?.preferredCommunicationChannel) ? input.preferredCommunicationChannel : 'email',
    postal_mail_active: input?.postalMailActive === true,
  };
  if (!changes.name) throw Object.assign(new Error('Der vollständige Kundenname ist erforderlich.'), { status: 400 });
  const result = await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(participantId)}&role=eq.user`, { method: 'PATCH', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(changes) });
  const rows = await result.json().catch(() => ([]));
  if (!result.ok || !rows[0]) throw new Error(rows.message || 'Kundenstammdaten konnten nicht gespeichert werden.');
}
async function readGuidedStates(result, participantId) {
  const id = encodeURIComponent(participantId);
  return Promise.all(Array.from({ length: 7 }, (_, index) => index + 2).map(async (week) => {
    const stateResponse = await fetch(`${result.service.url}/rest/v1/process_entries?user_profile_id=eq.${id}&week=eq.${week}&data_block=eq.week_${week}_state&select=structured_data&order=created_at.desc&limit=1`, { headers: serviceHeaders(result.service.key) });
    const rows = await stateResponse.json().catch(() => ([]));
    if (!stateResponse.ok) throw new Error(rows.message || `Woche ${week} konnte nicht für die Admin-Prüfung geladen werden.`);
    return normalizeGuidedWeekState(week, rows[0]?.structured_data?.[`week_${week}`]);
  }));
}

function technicalResult(states) {
  return states.flatMap((state) => {
    const definition = guidedWeekDefinition(state.week);
    const active = currentGuidedStep(state);
    return definition.steps.filter((step) => step.kind === 'external').map((step) => ({
      week: state.week,
      stepId: step.id,
      title: step.title,
      external: step.external,
      status: state.completed_steps.includes(step.id) ? 'confirmed' : active?.id === step.id ? 'pending' : 'not_reached',
      confirmation: state.external_results?.[step.id] || null,
    }));
  });
}

const readableValue = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Ja' : '';
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(' · ');
  if (typeof value === 'object') return Object.values(value).map(readableValue).filter(Boolean).join(' · ');
  return String(value).trim();
};

function weekOneAnswers(state = {}) {
  const answers = [];
  (state.wishes || []).forEach((wish, index) => {
    const value = readableValue(wish.final_answer || wish.desired_state || wish.raw_wish || wish.raw_answer);
    if (value) answers.push({ key: `wish_${index + 1}`, label: `Wunsch ${index + 1}`, value, status: wish.completed ? 'completed' : 'in_progress' });
  });
  const target = readableValue(state.fdd_target?.raw_answer || state.fdd_target?.desired_result || state.fdd_target?.desired_change);
  if (target) answers.push({ key: 'target', label: 'Ziel nach acht Wochen', value: target, status: state.fdd_target?.completed ? 'completed' : 'in_progress' });
  if (state.fdd_target?.clarification_raw) answers.push({ key: 'target_clarification', label: 'Ziel konkretisiert', value: readableValue(state.fdd_target.clarification_raw), status: 'completed' });
  if (Number(state.clarity_baseline?.score) >= 1) {
    const reason = readableValue(state.clarity_baseline?.reason_raw);
    answers.push({ key: 'clarity', label: 'Klarheits-Baseline', value: `${state.clarity_baseline.score} von 10${reason ? ` · ${reason}` : ''}`, status: state.clarity_baseline?.completed ? 'completed' : 'in_progress' });
  }
  const career = state.career_history || {};
  const careerValue = readableValue(career.stations) || readableValue(career.cv_file_name);
  if (careerValue) answers.push({ key: 'career', label: career.stations?.length ? 'Berufliche Stationen' : 'Lebenslauf', value: careerValue, status: career.completed ? 'completed' : 'in_progress' });
  return answers;
}

function guidedAnswers(week, state = {}) {
  const definition = guidedWeekDefinition(week);
  const answers = [];
  if (state.clarity_checkin?.completed || Number(state.clarity_checkin?.score) >= 1) {
    const note = readableValue(state.clarity_checkin?.note);
    answers.push({ key: 'clarity_checkin', label: 'Klarheits-Check-in', value: `${state.clarity_checkin.score} von 10${note ? ` · ${note}` : ''}`, status: state.clarity_checkin?.completed ? 'completed' : 'in_progress' });
  }
  for (const step of definition?.steps || []) {
    const answer = state.answers?.[step.id];
    const document = state.documents?.[step.id];
    const external = state.external_results?.[step.id];
    const value = readableValue(answer?.raw_answer) || readableValue(answer?.items) || readableValue(document?.fileName) || (external ? 'Technisches Ergebnis bestätigt' : '');
    if (!value) continue;
    answers.push({ key: step.id, label: step.title, question: step.question, value, status: state.completed_steps?.includes(step.id) ? 'completed' : 'in_progress' });
  }
  return answers;
}

export function processWeekResult(result) {
  const latest = new Map();
  [...(result.stateEntries || [])].sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)).forEach((entry) => {
    const week = Number(entry.week);
    if (!latest.has(week) && entry.data_block === `week_${week}_state`) latest.set(week, entry);
  });
  return Array.from({ length: 8 }, (_, index) => index + 1).map((week) => {
    const entry = latest.get(week);
    const stored = entry?.structured_data?.[`week_${week}`] || {};
    const state = week === 1 ? stored : normalizeGuidedWeekState(week, stored);
    const definition = guidedWeekDefinition(week);
    const access = result.serializedAccess.weekStates?.find((item) => Number(item.week) === week) || {};
    const released = Number(result.serializedAccess.processWeek) > 0 && (result.serializedAccess.automaticUnlockedWeeks || []).includes(week);
    return {
      week,
      title: week === 1 ? 'Ausgangslage' : definition?.title || `Woche ${week}`,
      stateStatus: state.status || 'not_started',
      currentStep: week === 1 ? weekOnePrompt(state).title : currentGuidedStep(state)?.title || null,
      updatedAt: released ? state.updated_at || entry?.created_at || null : null,
      completedAt: released ? state.completed_at || null : null,
      accessible: Boolean(access.accessible),
      completed: Boolean(access.completed),
      reason: access.reason || 'denied',
      unlocksAt: access.unlocksAt || null,
      answers: released ? (week === 1 ? weekOneAnswers(state) : guidedAnswers(week, state)) : [],
      reflection: released && access.completed && state.week_reflection && typeof state.week_reflection === 'object' ? state.week_reflection : null,
    };
  });
}

async function publicResult(result, participantId) {
  const states = await readGuidedStates(result, participantId);
  return { profile: result.profile, progress: result.progress, gates: result.gates, access: result.serializedAccess, technicalConfirmations: technicalResult(states), processWeeks: processWeekResult(result) };
}

async function confirmTechnicalResult(current, participantId, admin, confirmation) {
  const week = Number(confirmation?.week);
  const stepId = String(confirmation?.stepId || '');
  const note = String(confirmation?.note || '').trim().slice(0, 2000);
  const resultReference = String(confirmation?.resultReference || '').trim().slice(0, 500);
  if (!Number.isInteger(week) || week < 2 || week > 8 || !stepId || note.length < 5) throw Object.assign(new Error('Woche, technischer Schritt und ein nachvollziehbarer Prüfvermerk sind erforderlich.'), { status: 400 });
  if (!current.access.canAccessWeek(week)) throw Object.assign(new Error(`Woche ${week} ist zeitlich noch nicht freigeschaltet.`), { status: 409 });
  if (Number(current.access.processWeek) !== week) throw Object.assign(new Error(`Der aktuelle Arbeitsstand liegt in Woche ${current.access.processWeek}. Technische Ergebnisse dürfen nur dort bestätigt werden.`), { status: 409 });
  const states = await readGuidedStates(current, participantId);
  const state = states.find((item) => item.week === week);
  const active = currentGuidedStep(state);
  if (!active || active.id !== stepId || active.kind !== 'external') throw Object.assign(new Error('Nur der aktuell offene technische Schritt kann bestätigt werden.'), { status: 409 });
  const confirmationId = crypto.randomUUID();
  const update = applyGuidedWeekAction(state, { type: 'external_completed', stepId, external: active.external, verified: true, resultId: confirmationId });
  if (!update.ok) throw Object.assign(new Error(update.error), { status: 409 });
  update.state.external_results[stepId] = { ...update.state.external_results[stepId], confirmationId, resultReference: resultReference || null, note, confirmedAt: new Date().toISOString(), confirmedBy: admin.profile.id };
  const save = await fetch(`${current.service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(current.service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, data_block: `week_${week}_state`, raw_answer: note, structured_data: { [`week_${week}`]: update.state, admin_confirmation: { id: confirmationId, step_id: stepId, external: active.external, result_reference: resultReference || null, note, confirmed_by: admin.profile.id, confirmed_by_email: admin.profile.email, confirmed_at: update.state.external_results[stepId].confirmedAt } }, evidence_level: 'admin_confirmed' }) });
  if (!save.ok) throw new Error('Die technische Admin-Bestätigung konnte nicht auditierbar gespeichert werden.');
  const savedEntries = await save.json().catch(() => ([]));
  const evidenceEntryId = savedEntries[0]?.id || null;
  const gateValues = guidedGateStatus(update.state);
  await Promise.all(current.gates.filter((gate) => Number(gate.week) === week && gate.gate_key in gateValues).map(async (gate) => {
    const gateResponse = await fetch(`${current.service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gate.id)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, { method: 'PATCH', headers: serviceHeaders(current.service.key), body: JSON.stringify({ completed_at: gateValues[gate.gate_key] ? (gate.completed_at || new Date().toISOString()) : null, evidence_entry_id: gateValues[gate.gate_key] ? evidenceEntryId : null }) });
    if (!gateResponse.ok) throw new Error('Der technische Gate-Status konnte nicht synchronisiert werden.');
  }));
}

export default async function handler(request, response) {
  const admin = await requireCurrentAdmin(request, response, request.method === 'GET' ? ['customers', 'program', 'sales_calls'] : ['customers', 'program']);
  if (!admin) return;
  const participantId = request.query?.participantId || request.body?.participantId;
  if (!isUuid(participantId)) return response.status(400).json({ error: 'Gültige Teilnehmer-ID fehlt.' });
  try {
    if (request.method === 'GET') {
      const result = await getParticipantProgramAccess(participantId);
      return response.status(200).json(await publicResult(result, participantId));
    }
    if (request.method !== 'PATCH') return response.status(405).json({ error: 'Methode nicht erlaubt.' });

    const current = await getParticipantProgramAccess(participantId);
    const body = request.body || {};
    if (body.customerProfile) await patchCustomerProfile(current.service, participantId, body.customerProfile);
    if (body.technicalConfirmation) {
      await confirmTechnicalResult(current, participantId, admin, body.technicalConfirmation);
      return response.status(200).json(await publicResult(await getParticipantProgramAccess(participantId), participantId));
    }
    const changes = {};
    if (body.accessMode !== undefined || body.manuallyUnlockedWeeks !== undefined || body.manuallyLockedWeeks !== undefined) return response.status(409).json({ error: 'Die Wochenfreischaltung ist fest zeitbasiert und erfolgt automatisch alle sieben Tage ab Projektstart.' });
    if (body.programStartDate !== undefined) {
      if (!validDate(body.programStartDate)) return response.status(400).json({ error: 'Ungültiges Startdatum.' });
      changes.program_start_date = body.programStartDate;
    }
    if (body.programStatus !== undefined) {
      if (!Object.values(PROGRAM_STATUSES).includes(body.programStatus)) return response.status(400).json({ error: 'Ungültiger Programmstatus.' });
      changes.program_status = body.programStatus;
    }
    if (body.currentWeek !== undefined) return response.status(409).json({ error: 'Die aktuelle Arbeitswoche wird ausschließlich aus den vollständig abgeschlossenen Wochen ermittelt und kann nicht manuell gesetzt werden.' });
    if (body.resetToOnboarding === true) {
      Object.assign(changes, {
        current_week: 0,
        process_status: 'ONBOARDING',
        program_status: 'active',
        access_mode: 'time_based',
        manually_unlocked_weeks: [],
        manually_locked_weeks: [],
        privacy_consent_at: null,
        start_commitment_at: null,
        final_commitment_at: null,
        last_activity_at: null,
      });
    }
    if (Object.keys(changes).length) await patchParticipantProgress(current.service, participantId, changes);
    const effective = Object.keys(changes).length ? await getParticipantProgramAccess(participantId) : current;
    if (Array.isArray(body.gateUpdates)) {
      for (const update of body.gateUpdates) {
        if (!isUuid(update.gateId)) throw new Error('Ungültige Gate-ID in der Fortschrittskorrektur.');
        const gate = effective.gates.find((item) => item.id === update.gateId);
        if (!gate) throw Object.assign(new Error('Das Pflichtfeld gehört nicht zu diesem Teilnehmer.'), { status: 404 });
        if (update.completed && Number(gate.week) >= 1 && !effective.access.canAccessWeek(gate.week)) throw Object.assign(new Error(`Woche ${gate.week} ist zeitlich noch gesperrt. Ihre Pflichtfelder können noch nicht abgeschlossen werden.`), { status: 409 });
        const gateResponse = await fetch(`${current.service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(update.gateId)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, {
          method: 'PATCH', headers: serviceHeaders(current.service.key), body: JSON.stringify({ completed_at: update.completed ? new Date().toISOString() : null }),
        });
        if (!gateResponse.ok) throw new Error('Fortschrittskorrektur konnte nicht gespeichert werden.');
      }
    }
    return response.status(200).json(await publicResult(await getParticipantProgramAccess(participantId), participantId));
  } catch (error) {
    const status = error.status || (/nicht gefunden/.test(error.message) ? 404 : 500);
    return response.status(status).json({ error: error.message || 'Programmsteuerung konnte nicht verarbeitet werden.' });
  }
}
