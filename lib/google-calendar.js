import crypto from 'node:crypto';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];
const REDIRECT_URI = 'https://findedeinding.vercel.app/api/google/callback';

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET ist nicht konfiguriert.');
  return crypto.createHash('sha256').update(process.env.AUTH_SECRET).digest();
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret, redirectUri: REDIRECT_URI } : null;
}

function signature(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createOAuthState(profileId) {
  const payload = Buffer.from(JSON.stringify({ profileId, nonce: crypto.randomUUID(), expires: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyOAuthState(value, profileId) {
  const [payload, signed] = String(value || '').split('.');
  if (!payload || !signed) return false;
  const expected = signature(payload);
  if (signed.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.profileId === profileId && data.expires > Date.now();
  } catch { return false; }
}

export function authorizationUrl(profileId) {
  const config = googleConfig();
  if (!config) throw new Error('Google OAuth ist noch nicht konfiguriert.');
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: createOAuthState(profileId) });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

async function tokenRequest(parameters) {
  const result = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.error_description || 'Google-Zugriffstoken konnte nicht erstellt werden.');
  return data;
}

export async function exchangeAuthorizationCode(code) {
  const config = googleConfig();
  if (!config) throw new Error('Google OAuth ist noch nicht konfiguriert.');
  return tokenRequest({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' });
}

export async function refreshAccessToken(refreshToken) {
  const config = googleConfig();
  if (!config) throw new Error('Google OAuth ist noch nicht konfiguriert.');
  const data = await tokenRequest({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' });
  return data.access_token;
}

export function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptCredential(value) {
  const [iv, tag, encrypted] = String(value || '').split('.');
  if (!iv || !tag || !encrypted) throw new Error('Google-Verbindung ist beschädigt.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function emailFromIdToken(idToken) {
  try { return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email || null; }
  catch { return null; }
}

async function googleRequest(path, accessToken, options = {}) {
  const result = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = result.status === 204 ? null : await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(data?.error?.message || 'Google Calendar konnte die Anfrage nicht verarbeiten.'), { status: result.status });
  return data;
}

export async function assertCalendarAvailable(accessToken, start, end) {
  const data = await googleRequest('freeBusy', accessToken, { method: 'POST', body: JSON.stringify({ timeMin: start, timeMax: end, timeZone: 'Europe/Berlin', items: [{ id: 'primary' }] }) });
  if (data.calendars?.primary?.errors?.length) throw new Error('Die Kalenderverfügbarkeit konnte nicht geprüft werden.');
  if (data.calendars?.primary?.busy?.length) throw Object.assign(new Error('Der gewählte Zeitraum ist im Google-Kalender bereits belegt.'), { status: 409 });
}

function eventBody(lead, start, end, includeConference) {
  const body = {
    summary: `Finde dein Ding – Erstgespräch mit ${lead.name}`,
    description: `CRM-Lead: ${lead.name}\nE-Mail: ${lead.email}\nTelefon: ${lead.phone || '—'}\nAnliegen: ${lead.challenge || '—'}`,
    start: { dateTime: start, timeZone: 'Europe/Berlin' },
    end: { dateTime: end, timeZone: 'Europe/Berlin' },
    attendees: [{ email: lead.email, displayName: lead.name }],
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }, { method: 'popup', minutes: 15 }] },
  };
  if (includeConference) body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  return body;
}

export async function saveCalendarEvent(accessToken, lead, start, end) {
  const encodedCalendar = encodeURIComponent('primary');
  if (lead.calendar_event_id) {
    return googleRequest(`calendars/${encodedCalendar}/events/${encodeURIComponent(lead.calendar_event_id)}?conferenceDataVersion=1&sendUpdates=all`, accessToken, { method: 'PATCH', body: JSON.stringify(eventBody(lead, start, end, false)) });
  }
  return googleRequest(`calendars/${encodedCalendar}/events?conferenceDataVersion=1&sendUpdates=all`, accessToken, { method: 'POST', body: JSON.stringify(eventBody(lead, start, end, true)) });
}

export async function deleteCalendarEvent(accessToken, eventId) {
  return googleRequest(`calendars/${encodeURIComponent('primary')}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, accessToken, { method: 'DELETE' });
}
