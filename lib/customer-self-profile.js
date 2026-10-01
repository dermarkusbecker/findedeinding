import { authenticateUser } from './user-auth.js';
import { syncCustomerProfileToLead } from './contact-lifecycle.js';

const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

async function readRows(response, message) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw fail(data.message || data.error || message, response.status);
  return data;
}

export async function updateOwnContactProfile(service, context, input = {}) {
  if (context.admin || context.adminPreview) throw fail('Diese Ansicht ist schreibgeschützt.', 403);
  const id = encodeURIComponent(context.participantId);
  const currentRows = await readRows(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${id}&role=eq.user&status=eq.active&select=id,auth_user_id,email&limit=1`, { headers: headers(service.key) }), 'Kundenkonto konnte nicht geladen werden.');
  const current = currentRows[0];
  if (!current) throw fail('Kundenkonto wurde nicht gefunden.', 404);

  const name = clean(input.name, 160);
  const email = clean(input.email, 254).toLowerCase();
  const emailConfirmation = clean(input.emailConfirmation, 254).toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) throw fail('Name und gültige E-Mail-Adresse sind erforderlich.');
  const emailChanged = email !== current.email?.toLowerCase();
  if (emailChanged && email !== emailConfirmation) throw fail('Die neue E-Mail-Adresse und ihre Wiederholung stimmen nicht überein.');

  const streetName = clean(input.streetName, 160);
  const houseNumber = clean(input.houseNumber, 30);
  const street = [streetName, houseNumber].filter(Boolean).join(' ') || null;
  const preferredChannel = ['email', 'phone', 'whatsapp'].includes(input.preferredChannel) ? input.preferredChannel : 'email';
  const mobilePhone = clean(input.mobilePhone, 40) || null;
  const whatsappSameAsMobile = input.whatsappSameAsMobile === true;
  const changes = {
    name, email,
    birth_date: /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate || '') ? input.birthDate : null,
    street,
    postal_code: clean(input.postalCode, 20) || null,
    city: clean(input.city, 120) || null,
    country: clean(input.country, 80) || 'Deutschland',
    phone: clean(input.phone, 40) || null,
    mobile_phone: mobilePhone,
    whatsapp_same_as_mobile: whatsappSameAsMobile,
    whatsapp_phone: whatsappSameAsMobile ? mobilePhone : (clean(input.whatsappPhone, 40) || null),
    preferred_communication_channel: preferredChannel,
    postal_mail_active: input.postalMailActive === true,
  };

  if (emailChanged) {
    if (!current.auth_user_id) throw fail('Für dieses Konto fehlt der verknüpfte Login.', 409);
    if (!clean(input.currentPassword, 500)) throw fail('Bitte bestätige die neue E-Mail-Adresse mit deinem aktuellen Passwort.');
    const verified = await authenticateUser(current.email, input.currentPassword);
    if (verified.id !== context.participantId) throw fail('Das Passwort gehört nicht zu diesem Kundenkonto.', 403);
    const duplicates = await readRows(await fetch(`${service.url}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&id=neq.${id}&select=id&limit=1`, { headers: headers(service.key) }), 'E-Mail-Adresse konnte nicht geprüft werden.');
    if (duplicates[0]) throw fail('Diese E-Mail-Adresse wird bereits verwendet.', 409);
    await readRows(await fetch(`${service.url}/auth/v1/admin/users/${encodeURIComponent(current.auth_user_id)}`, { method: 'PUT', headers: headers(service.key), body: JSON.stringify({ email, email_confirm: true }) }), 'Login-E-Mail konnte nicht aktualisiert werden.');
  }

  let profile;
  try {
    const updated = await readRows(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${id}&role=eq.user&status=eq.active`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(changes) }), 'Kontaktdaten konnten nicht gespeichert werden.');
    profile = updated[0];
    if (!profile) throw fail('Kontaktdaten konnten nicht gespeichert werden.', 409);
  } catch (error) {
    if (emailChanged) await fetch(`${service.url}/auth/v1/admin/users/${encodeURIComponent(current.auth_user_id)}`, { method: 'PUT', headers: headers(service.key), body: JSON.stringify({ email: current.email, email_confirm: true }) }).catch(() => {});
    throw error;
  }

  let syncWarning = false;
  try { await syncCustomerProfileToLead(service, profile); }
  catch (error) { console.error('Kundenprofil gespeichert, CRM-Kontaktabgleich fehlgeschlagen', { profileId: context.participantId, error: error.message }); syncWarning = true; }
  return { profile, emailChanged, syncWarning };
}
