import { serviceHeaders } from './program-access-service.js';

export const ONBOARDING_FORM_KEYS = Object.freeze(['privacy_consent', 'start_commitment']);
const clean = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

function sanitizeDraft(formKey, input = {}) {
  if (formKey === 'privacy_consent') return {
    specialCategories: input.specialCategories === true,
    privacyNotice: input.privacyNotice === true,
    aiNotice: input.aiNotice === true,
    name: clean(input.name, 160),
    place: clean(input.place, 120),
    date: clean(input.date, 10),
  };
  if (formKey === 'start_commitment') return {
    name: clean(input.name, 160),
    startDate: clean(input.startDate, 10),
    why: clean(input.why, 600),
    change: clean(input.change, 600),
    costOfUnclarity: clean(input.costOfUnclarity, 600),
    place: clean(input.place, 120),
    signatureDate: clean(input.signatureDate, 10),
    accepted: input.accepted === true,
    wizardStep: Math.min(4, Math.max(0, Number(input.wizardStep) || 0)),
  };
  throw Object.assign(new Error('Unbekanntes Onboarding-Formular.'), { status: 400 });
}

async function responseData(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || fallback), { status: response.status });
  return data;
}

export async function readOnboardingFormDrafts(service, participantId, resetAt = null) {
  const rows = await responseData(await fetch(`${service.url}/rest/v1/participant_form_drafts?user_profile_id=eq.${encodeURIComponent(participantId)}&form_key=in.(${ONBOARDING_FORM_KEYS.join(',')})&select=form_key,draft_data,updated_at`, { headers: serviceHeaders(service.key) }), 'Die Formularentwürfe konnten nicht geladen werden.');
  const resetTime = resetAt ? new Date(resetAt).getTime() : 0;
  return Object.fromEntries(rows.filter((row) => !resetTime || new Date(row.updated_at).getTime() > resetTime).map((row) => [row.form_key, row.draft_data || {}]));
}

export async function saveOnboardingFormDraft(service, participantId, formKey, draft) {
  if (!ONBOARDING_FORM_KEYS.includes(formKey) || !draft || typeof draft !== 'object' || Array.isArray(draft)) throw Object.assign(new Error('Ungültiger Formularentwurf.'), { status: 400 });
  const draftData = sanitizeDraft(formKey, draft);
  const rows = await responseData(await fetch(`${service.url}/rest/v1/participant_form_drafts?on_conflict=user_profile_id,form_key`, {
    method: 'POST',
    headers: serviceHeaders(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({ user_profile_id: participantId, form_key: formKey, draft_data: draftData, updated_at: new Date().toISOString() }),
  }), 'Der Formularentwurf konnte nicht automatisch gespeichert werden.');
  if (!rows[0]) throw new Error('Der Formularentwurf wurde nicht bestätigt.');
  return { draft: rows[0].draft_data || draftData, savedAt: rows[0].updated_at };
}

export async function deleteOnboardingFormDraft(service, participantId, formKey = '') {
  if (formKey && !ONBOARDING_FORM_KEYS.includes(formKey)) throw Object.assign(new Error('Unbekanntes Onboarding-Formular.'), { status: 400 });
  const filter = formKey ? `&form_key=eq.${encodeURIComponent(formKey)}` : '';
  const response = await fetch(`${service.url}/rest/v1/participant_form_drafts?user_profile_id=eq.${encodeURIComponent(participantId)}${filter}`, { method: 'DELETE', headers: serviceHeaders(service.key) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Der Formularentwurf konnte nicht entfernt werden.');
  }
}
