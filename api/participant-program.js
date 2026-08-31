import { requireCurrentPermission } from '../lib/user-auth.js';
import { getParticipantProgramAccess, patchParticipantProgress, serviceHeaders } from '../lib/program-access-service.js';
import { isOnboardingComplete, reopenWeekState } from '../lib/program-access.js';

const programWeeks = [
  { week: 1, title: 'Ausgangslage', mode: 'Ist-Aufnahme', question: 'Stell dir vor, vor dir steht eine Fee und du hast genau drei Wünsche frei. Welche drei Dinge würdest du dir für dein Leben aktuell am meisten wünschen?', help: 'Nenne zunächst einfach alle drei. Danach vertiefen wir sie einzeln.', upload: 'Lebenslauf optional' },
  { week: 2, title: 'Fähigkeiten & Umfeld', mode: 'Datensammlung', question: 'Welche besonderen Fähigkeiten oder Qualifikationen hast du dir außerhalb deiner klassischen Ausbildung und deines Berufs angeeignet?', help: 'Denk auch an Hobbys, Ehrenamt, eigene Projekte oder langjährige Erfahrung.', upload: 'Nachweise optional' },
  { week: 3, title: 'Motivatoren', mode: 'Auswahl', question: 'Wenn du auf dein heutiges Leben schaust: Welcher deiner fünf wichtigsten Motivatoren kommt aktuell am deutlichsten zu kurz?', help: 'Wir betrachten das als Puzzleteil – nicht automatisch als Berufskriterium.', upload: 'Workbook optional' },
  { week: 4, title: 'Halbzeit', mode: 'Synthese', question: 'Sollte das Thema „Gestaltungsfreiheit“ eher in deinem Ding enthalten sein, in deinem Leben, in beidem – oder weißt du es noch nicht?', help: 'Du ordnest selbst zu. Human Design bleibt dabei nur eine ergänzende Perspektive.', upload: 'Halbzeitanalyse bestätigen' },
  { week: 5, title: 'Werte & Lebenswerk', mode: 'Reflexion', question: 'Welche Eigenschaft bewunderst du an anderen Menschen besonders – und was berührt dich daran?', help: 'Wir unterscheiden später zwischen eigener Stärke, Potenzial und Wunsch.', upload: 'Grabrede erforderlich' },
  { week: 6, title: 'Dein-Ding-Map', mode: 'Verdichtung', question: 'Wenn du an eine zukünftige Tätigkeit denkst: Was möchtest du auf keinen Fall mehr in deinem Arbeitsalltag haben?', help: 'Wir sammeln mindestens zehn konkrete Ausschlusskriterien und formulieren danach deine gewünschten Gegenstücke.', upload: 'Perfekter Tag erforderlich' },
  { week: 7, title: 'Optionen & Realität', mode: 'Entscheidung', question: 'Wenn du alles zusammennimmst: Welche Richtungen oder Tätigkeiten fühlen sich so an, als könnte etwas für dich darin stecken?', help: 'Du nennst zuerst eigene Optionen. Mindestens eine davon bekommt einen kleinen, sicheren Realitätskontakt.', upload: 'Zukunfts-Timelines erforderlich' },
  { week: 8, title: 'Umsetzung', mode: 'Handeln', question: 'Was sind die ein bis drei konkreten Dinge, die du innerhalb der nächsten 24 Stunden tun kannst, damit deine Entscheidung nicht nur auf Papier steht?', help: 'Kontrollierbare Handlungen zählen mehr als Ergebnisse, die du nicht direkt beeinflussen kannst.', upload: 'Commitment erforderlich' },
];

const weekContent = (week, gates) => {
  const content = programWeeks.find((item) => item.week === Number(week));
  if (!content) return null;
  return { ...content, tasks: gates.filter((gate) => Number(gate.week) === Number(week) && gate.required !== false).map((gate) => ({ id: gate.id, key: gate.gate_key, label: gate.label, completed: Boolean(gate.completed_at) })) };
};

async function setGate(service, participantId, gateId, completed) {
  const response = await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gateId)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, {
    method: 'PATCH', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ completed_at: completed ? new Date().toISOString() : null }),
  });
  const rows = await response.json();
  if (!response.ok || !rows[0]) throw new Error(rows.message || 'Pflichtaufgabe wurde nicht gefunden.');
  return rows[0];
}

export default async function handler(request, response) {
  const session = await requireCurrentPermission('clara_program')(request, response);
  if (!session) return;
  try {
    const result = await getParticipantProgramAccess(session.participantId);
    if (request.method === 'GET') {
      const onboardingComplete = isOnboardingComplete(result.progress);
      const requestedWeek = request.query?.week === undefined ? null : Number(request.query.week);
      if (requestedWeek !== null && (!Number.isInteger(requestedWeek) || requestedWeek < 1 || requestedWeek > 8)) return response.status(400).json({ error: 'Ungültige Woche.' });
      if (!onboardingComplete && requestedWeek !== null) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      if (requestedWeek !== null && !result.access.canAccessWeek(requestedWeek)) return response.status(403).json({ error: 'Diese Woche ist noch nicht freigeschaltet.', access: result.serializedAccess });
      const accessibleWeeks = (onboardingComplete ? result.access.unlockedWeeks : []).map((week) => {
        const content = programWeeks.find((item) => item.week === week);
        return { week, title: content.title, mode: content.mode };
      });
      const selectedWeek = onboardingComplete ? (requestedWeek || (result.access.canAccessWeek(result.progress.current_week) ? Number(result.progress.current_week) : result.access.unlockedWeeks[0] || 0)) : 0;
      return response.status(200).json({ profile: { id: result.profile.id, name: result.profile.name }, access: result.serializedAccess, onboardingComplete, accessibleWeeks, selectedWeek, week: selectedWeek ? weekContent(selectedWeek, result.gates) : null });
    }
    if (request.method !== 'PATCH') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
    const action = request.body?.action;
    if (action === 'start') {
      if (result.access.status !== 'active') return response.status(423).json({ error: 'Dein Programm ist aktuell pausiert.' });
      const commitmentConfirmed = request.body?.commitment === true;
      const signedDocumentUploaded = request.body?.signedDocument === true;
      if (!request.body?.privacy || !commitmentConfirmed || !signedDocumentUploaded) return response.status(400).json({ error: 'Bitte bestätige deine Einwilligung und lade dein unterschriebenes Commitment hoch.' });
      const startGates = result.gates.filter((gate) => Number(gate.week) === 0);
      const now = new Date().toISOString();
      const berlinDateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const datePart = (type) => berlinDateParts.find((part) => part.type === type)?.value;
      const programStartDate = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
      await Promise.all([
        patchParticipantProgress(result.service, session.participantId, { privacy_consent_at: now, start_commitment_at: now, program_start_date: programStartDate, current_week: 1, process_status: 'WEEK_1', last_activity_at: now }),
        Promise.allSettled(startGates.map((gate) => setGate(result.service, session.participantId, gate.id, true))),
      ]);
      return response.status(200).json({ ok: true, started: true, week: 1 });
    } else if (action === 'revoke_privacy') {
      const now = new Date().toISOString();
      await patchParticipantProgress(result.service, session.participantId, { privacy_consent_at: null, current_week: 0, process_status: 'ONBOARDING', last_activity_at: now });
    } else if (action === 'set_gate') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
      const gate = result.gates.find((item) => item.id === request.body?.gateId && Number(item.week) === week);
      if (!gate) return response.status(404).json({ error: 'Pflichtaufgabe wurde nicht gefunden.' });
      await setGate(result.service, session.participantId, gate.id, Boolean(request.body?.completed));
      await patchParticipantProgress(result.service, session.participantId, { last_activity_at: new Date().toISOString() });
    } else if (action === 'save_answer') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      const answer = typeof request.body?.answer === 'string' ? request.body.answer.trim().slice(0, 10000) : '';
      if (!answer) return response.status(400).json({ error: 'Antwort fehlt.' });
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
      const insert = await fetch(`${result.service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(result.service.key), body: JSON.stringify({ user_profile_id: session.participantId, week, data_block: `week_${week}_dialog`, raw_answer: answer, evidence_level: 'participant_statement' }) });
      if (!insert.ok) throw new Error('Antwort konnte nicht gespeichert werden.');
      const firstGate = result.gates.find((gate) => Number(gate.week) === week && gate.required !== false);
      if (firstGate) await setGate(result.service, session.participantId, firstGate.id, true);
      await patchParticipantProgress(result.service, session.participantId, { last_activity_at: new Date().toISOString() });
    } else if (action === 'reopen_week') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (!Number.isInteger(week) || week < 1 || week > 8) return response.status(400).json({ error: 'Ungültige Woche für den Replay.' });
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist derzeit nicht zugänglich.' });
      const resetState = reopenWeekState(week);
      await patchParticipantProgress(result.service, session.participantId, { current_week: resetState.current_week, process_status: resetState.process_status, last_activity_at: new Date().toISOString() });
    } else if (action === 'complete_week') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
      const required = result.gates.filter((gate) => Number(gate.week) === week && gate.required !== false);
      if (!required.length || required.some((gate) => !gate.completed_at)) return response.status(409).json({ error: 'Die Woche ist erst abgeschlossen, wenn alle Pflichtaufgaben bestätigt sind.' });
      const nextWeek = Math.min(8, week + 1);
      await patchParticipantProgress(result.service, session.participantId, { current_week: nextWeek, process_status: week === 8 ? 'FINAL_REPORT' : `WEEK_${nextWeek}`, last_activity_at: new Date().toISOString() });
    } else return response.status(400).json({ error: 'Unbekannte Aktion.' });
    const updated = await getParticipantProgramAccess(session.participantId);
    return response.status(200).json({ ok: true, access: updated.serializedAccess });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Programmzugriff konnte nicht verarbeitet werden.' });
  }
}
