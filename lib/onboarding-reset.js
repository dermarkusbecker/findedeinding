import { resetParticipantProgressState } from './program-access.js';
import { isUuid, patchParticipantProgress, serviceHeaders } from './program-access-service.js';
import { staffPermissionsFor } from './staff-roles.js';

const errorWithStatus = (message, status) => Object.assign(new Error(message), { status });

export function artifactIsAfterOnboardingReset(artifact, resetAt) {
  if (!artifact) return false;
  if (!resetAt) return true;
  const artifactTime = new Date(artifact.participant_confirmed_at || artifact.created_at || 0).getTime();
  const resetTime = new Date(resetAt).getTime();
  return Number.isFinite(artifactTime) && Number.isFinite(resetTime) && artifactTime > resetTime;
}

export async function assertActivePreviewAdmin(service, session) {
  if (session?.adminPreview !== true || !isUuid(session?.adminProfileId)) throw errorWithStatus('Diese Aktion ist nur im sicheren Admin-Kundenzugang verfügbar.', 403);
  const result = await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(session.adminProfileId)}&role=eq.admin&status=eq.active&select=id,staff_role,staff_permissions&limit=1`, { headers: serviceHeaders(service.key) });
  const rows = await result.json().catch(() => ([]));
  if (!result.ok) throw errorWithStatus(rows.message || 'Die Admin-Berechtigung konnte nicht geprüft werden.', result.status);
  const profile = rows[0];
  const permissions = profile?.staff_permissions?.length ? profile.staff_permissions : staffPermissionsFor(profile?.staff_role);
  if (!profile || !permissions.some((permission) => ['customers', 'program'].includes(permission))) throw errorWithStatus('Für das Zurücksetzen fehlt die Admin-Berechtigung.', 403);
  return profile;
}

export async function resetParticipantOnboarding({ service, participantId, adminProfileId, gates = [] }) {
  if (!isUuid(participantId) || !isUuid(adminProfileId)) throw errorWithStatus('Kunde oder Admin konnte nicht eindeutig zugeordnet werden.', 400);
  const resetAt = new Date().toISOString();
  await patchParticipantProgress(service, participantId, { ...resetParticipantProgressState(), onboarding_reset_at: resetAt, onboarding_reset_by_profile_id: adminProfileId });
  const onboardingGates = gates.filter((gate) => Number(gate.week) === 0);
  await Promise.all(onboardingGates.map(async (gate) => {
    const result = await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gate.id)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, { method: 'PATCH', headers: serviceHeaders(service.key), body: JSON.stringify({ completed_at: null, evidence_entry_id: null }) });
    if (!result.ok) throw new Error('Die Onboarding-Schritte konnten nicht vollständig zurückgesetzt werden.');
  }));
  return { resetAt };
}
