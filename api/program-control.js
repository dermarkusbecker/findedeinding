import { requireCurrentAdmin } from '../lib/user-auth.js';
import { ACCESS_MODES, PROGRAM_STATUSES, PROGRAM_WEEKS } from '../lib/program-access.js';
import { getParticipantProgramAccess, isUuid, patchParticipantProgress, serviceHeaders } from '../lib/program-access-service.js';

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const normalizeWeeks = (value) => [...new Set((Array.isArray(value) ? value : []).map(Number).filter((week) => PROGRAM_WEEKS.includes(week)))].sort((a, b) => a - b);

function publicResult(result) {
  return { profile: result.profile, progress: result.progress, gates: result.gates, access: result.serializedAccess };
}

export default async function handler(request, response) {
  if (!await requireCurrentAdmin(request, response)) return;
  const participantId = request.query?.participantId || request.body?.participantId;
  if (!isUuid(participantId)) return response.status(400).json({ error: 'Gültige Teilnehmer-ID fehlt.' });
  try {
    if (request.method === 'GET') return response.status(200).json(publicResult(await getParticipantProgramAccess(participantId)));
    if (request.method !== 'PATCH') return response.status(405).json({ error: 'Methode nicht erlaubt.' });

    const current = await getParticipantProgramAccess(participantId);
    const body = request.body || {};
    const changes = {};
    if (body.accessMode !== undefined) {
      if (!Object.values(ACCESS_MODES).includes(body.accessMode)) return response.status(400).json({ error: 'Ungültiger Freischaltungsmodus.' });
      changes.access_mode = body.accessMode;
    }
    if (body.programStartDate !== undefined) {
      if (!validDate(body.programStartDate)) return response.status(400).json({ error: 'Ungültiges Startdatum.' });
      changes.program_start_date = body.programStartDate;
    }
    if (body.programStatus !== undefined) {
      if (!Object.values(PROGRAM_STATUSES).includes(body.programStatus)) return response.status(400).json({ error: 'Ungültiger Programmstatus.' });
      changes.program_status = body.programStatus;
    }
    if (body.currentWeek !== undefined) {
      const currentWeek = Number(body.currentWeek);
      if (!Number.isInteger(currentWeek) || currentWeek < 0 || currentWeek > 8) return response.status(400).json({ error: 'Aktuelle Woche muss zwischen 0 und 8 liegen.' });
      changes.current_week = currentWeek;
      changes.process_status = currentWeek ? `WEEK_${currentWeek}` : 'ONBOARDING';
    }
    if (body.manuallyUnlockedWeeks !== undefined) changes.manually_unlocked_weeks = normalizeWeeks(body.manuallyUnlockedWeeks);
    if (body.manuallyLockedWeeks !== undefined) changes.manually_locked_weeks = normalizeWeeks(body.manuallyLockedWeeks);
    if (body.resetToOnboarding === true) {
      Object.assign(changes, {
        current_week: 0,
        process_status: 'ONBOARDING',
        program_status: 'active',
        access_mode: 'completion_based',
        manually_unlocked_weeks: [],
        manually_locked_weeks: [],
        privacy_consent_at: null,
        start_commitment_at: null,
        final_commitment_at: null,
        last_activity_at: null,
      });
    }
    const overlaps = (changes.manually_unlocked_weeks || current.progress.manually_unlocked_weeks || []).filter((week) => (changes.manually_locked_weeks || current.progress.manually_locked_weeks || []).includes(week));
    if (overlaps.length) return response.status(400).json({ error: `Eine Woche kann nicht gleichzeitig manuell frei und gesperrt sein: ${overlaps.join(', ')}` });

    if (Object.keys(changes).length) await patchParticipantProgress(current.service, participantId, changes);
    if (Array.isArray(body.gateUpdates)) {
      for (const update of body.gateUpdates) {
        if (!isUuid(update.gateId)) throw new Error('Ungültige Gate-ID in der Fortschrittskorrektur.');
        const gateResponse = await fetch(`${current.service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(update.gateId)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, {
          method: 'PATCH', headers: serviceHeaders(current.service.key), body: JSON.stringify({ completed_at: update.completed ? new Date().toISOString() : null }),
        });
        if (!gateResponse.ok) throw new Error('Fortschrittskorrektur konnte nicht gespeichert werden.');
      }
    }
    return response.status(200).json(publicResult(await getParticipantProgramAccess(participantId)));
  } catch (error) {
    const status = /nicht gefunden/.test(error.message) ? 404 : 500;
    return response.status(status).json({ error: error.message || 'Programmsteuerung konnte nicht verarbeitet werden.' });
  }
}
