import { mailAppearance, sendPreparedMail } from './branded-mail-service.js';
import { renderBrandedEmail } from './branded-email.js';

const headers = service => ({ apikey: service.key || service.serviceKey, Authorization: `Bearer ${service.key || service.serviceKey}`, 'Content-Type': 'application/json' });
const setupDestination = 'https://findedeinding.com/login?setup=1';
const replace = (value, tokens) => String(value || '').replace(/{{([a-z_]+)}}/gi, (_, key) => String(tokens[key] ?? ''));
const htmlEscape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function rows(service, path, options = {}) {
  const response = await fetch(`${service.url}/rest/v1/${path}`, { ...options, headers: { ...headers(service), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error(body.message || 'Portalzugangs-E-Mail konnte nicht verarbeitet werden.');
  return body;
}

export async function generatePortalSetupLink(service, email) {
  const response = await fetch(`${service.url}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: headers(service),
    body: JSON.stringify({ type: 'recovery', email, redirect_to: setupDestination }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Der sichere Einrichtungslink konnte nicht erzeugt werden.');
  let link;
  try { link = new URL(data.action_link); } catch { throw new Error('Der Einrichtungslink ist ungültig.'); }
  if (link.origin !== new URL(service.url).origin || link.pathname !== '/auth/v1/verify' || link.searchParams.get('type') !== 'recovery' || link.searchParams.get('redirect_to') !== setupDestination) {
    throw new Error('Der Einrichtungslink führt nicht zum Kundenportal. Bitte Auth-Weiterleitung prüfen.');
  }
  return link.href;
}

async function sendOne(service, { lead, profile, eventKey, appearance, sendMail, linkGenerator }) {
  const existing = (await rows(service, `lead_communications?event_key=eq.${encodeURIComponent(eventKey)}&select=*&limit=1`))[0];
  if (existing?.delivery_status === 'accepted') return 'already_accepted';
  if (existing && !['draft', 'failed'].includes(existing.delivery_status)) return 'check_mailbox';
  const template = (await rows(service, 'communication_templates?template_key=eq.participant_setup_link&status=eq.active&select=*&limit=1'))[0];
  if (!template || !['login_name', 'email', 'setup_link'].every(key => String(template.body || '').includes(`{{${key}}}`))) throw new Error('Die aktive Zugangsmail-Vorlage muss Benutzername, E-Mail und Einrichtungslink enthalten.');
  if (String(template.subject || '').includes('{{setup_link}}')) throw new Error('Der geheime Einrichtungslink darf nicht im E-Mail-Betreff stehen.');
  const link = await linkGenerator(service, profile.email);
  const tokens = { vorname: String(profile.name || lead.name || '').trim().split(/\s+/)[0], login_name: profile.portal_username, email: profile.email, setup_link: link };
  const subject = replace(template.subject, tokens);
  const body = replace(template.body, tokens);
  const rendered = renderBrandedEmail({ subject, body, ...appearance });
  const escapedLink = htmlEscape(link);
  if (!rendered.html.includes(escapedLink)) throw new Error('Der Einrichtungslink konnte nicht in die E-Mail eingefügt werden.');
  const html = rendered.html.replace(escapedLink, `<a href="${escapedLink}" style="display:inline-block;background:#ff9453;color:#103344;font-weight:bold;padding:12px 20px;text-decoration:none;border-radius:8px">Passwort jetzt festlegen</a>`);
  // The single-use link grants access. Never persist it in CRM history or logs.
  const safeBody = replace(template.body, { ...tokens, setup_link: '[Einmaliger Einrichtungslink aus Sicherheitsgründen nicht gespeichert]' });
  const safeRendered = renderBrandedEmail({ subject, body: safeBody, ...appearance });
  let record = existing;
  if (!record) record = (await rows(service, 'lead_communications', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ lead_id: lead.id, user_profile_id: profile.id, channel: 'email', direction: 'outbound', subject, body: safeRendered.text, body_html: safeRendered.html, preview: 'Benutzername, E-Mail und Passwort-Einrichtungslink · Link nicht gespeichert', recipient_email: profile.email, delivery_status: 'draft', signature_id: appearance.signature?.id || null, sent_by_name: 'CRM', attachments: [], automation_source: 'contract_signed', event_key: eventKey }) }))[0];
  const reserved = await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.${record.delivery_status}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ delivery_status: 'pending', updated_at: new Date().toISOString() }) });
  if (!reserved[0]) return 'check_mailbox';
  try {
    const sent = await sendMail({ to: profile.email, subject, text: rendered.text, html });
    const accepted = await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ delivery_status: 'accepted', provider_message_id: sent.providerMessageId, sender_email: sent.senderEmail, occurred_at: new Date().toISOString(), updated_at: new Date().toISOString(), preview: 'Einrichtungslink · Von STRATO angenommen; Zustellung nicht bestätigt.' }) });
    if (!accepted[0]) return 'check_mailbox';
    return 'accepted';
  } catch (error) {
    const certain = ['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error.code) || [400, 503].includes(error.status);
    await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: certain ? 'failed' : 'unknown', preview: certain ? 'STRATO-Versand fehlgeschlagen.' : 'Versandstatus unklar: Postfach vor erneutem Versuch prüfen.', updated_at: new Date().toISOString() }) }).catch(() => null);
    throw error;
  }
}

export async function sendPortalAccessEmails(service, { lead, profile }, { sendMail = sendPreparedMail, appearanceLoader = mailAppearance, linkGenerator = generatePortalSetupLink, eventKeySuffix = '' } = {}) {
  if (!lead?.id || !profile?.id || !profile?.email || !profile?.portal_username) throw new Error('Die Portal-Zugangsdaten sind unvollständig.');
  const appearance = await appearanceLoader(service);
  const suffix = `${profile.id}:${eventKeySuffix || profile.one_time_password_issued_at || new Date().toISOString()}`;
  const setup = await sendOne(service, { lead, profile, eventKey: `portal-setup:${suffix}`, appearance, sendMail, linkGenerator });
  if (['accepted', 'already_accepted'].includes(setup)) await rows(service, `user_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: 'PATCH', body: JSON.stringify({ access_invite_sent_at: new Date().toISOString() }) });
  return { setup };
}

export async function sendBrandedRecoveryEmail(service, profile, { purpose = 'password_reset', sendMail = sendPreparedMail, appearanceLoader = mailAppearance, linkGenerator = generatePortalSetupLink } = {}) {
  if (!profile?.email || !profile?.name) throw new Error('Für diesen Zugang fehlen Name oder E-Mail-Adresse.');
  const appearance = await appearanceLoader(service);
  const link = await linkGenerator(service, profile.email);
  const subject = purpose === 'invitation' ? 'Deinen Zugang einrichten' : 'Dein Passwort neu festlegen';
  const firstName = String(profile.name).trim().split(/\s+/)[0];
  const loginName = profile.portal_username ? `Dein Benutzername: ${profile.portal_username}\nDu kannst dich auch mit deiner E-Mail-Adresse anmelden.\n\n` : '';
  const body = `Hallo ${firstName},\n\n${loginName}über den folgenden Link kannst du dein persönliches Passwort selbst festlegen:\n\n${link}\n\nFalls du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.`;
  const rendered = renderBrandedEmail({ subject, body, ...appearance });
  const escapedLink = htmlEscape(link);
  if (!rendered.html.includes(escapedLink)) throw new Error('Der Passwort-Link konnte nicht in die E-Mail eingefügt werden.');
  const html = rendered.html.replace(escapedLink, `<a href="${escapedLink}" style="display:inline-block;background:#ff9453;color:#103344;font-weight:bold;padding:12px 20px;text-decoration:none;border-radius:8px">Passwort festlegen</a>`);
  return sendMail({ to: profile.email, subject, text: rendered.text, html });
}
