import { mailAppearance, sendPreparedMail } from './branded-mail-service.js';
import { renderBrandedEmail } from './branded-email.js';

const headers = service => ({ apikey: service.key || service.serviceKey, Authorization: `Bearer ${service.key || service.serviceKey}`, 'Content-Type': 'application/json' });
const loginUrl = 'https://findedeinding.com/login?bereich=kunde';
const replace = (value, tokens) => String(value || '').replace(/{{([a-z_]+)}}/gi, (_, key) => String(tokens[key] ?? ''));

async function rows(service, path, options = {}) {
  const response = await fetch(`${service.url}/rest/v1/${path}`, { ...options, headers: { ...headers(service), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error(body.message || 'Portalzugangs-E-Mail konnte nicht verarbeitet werden.');
  return body;
}

async function sendOne(service, { lead, profile, password, templateKey, eventKey, tokens, appearance, sendMail }) {
  const existing = (await rows(service, `lead_communications?event_key=eq.${encodeURIComponent(eventKey)}&select=*&limit=1`))[0];
  if (existing?.delivery_status === 'accepted') return 'already_accepted';
  if (existing && !['draft', 'failed'].includes(existing.delivery_status)) return 'check_mailbox';
  const template = (await rows(service, `communication_templates?template_key=eq.${encodeURIComponent(templateKey)}&status=eq.active&select=*&limit=1`))[0];
  if (!template) throw new Error(`Aktive E-Mail-Vorlage ${templateKey} fehlt.`);
  const requiredTokens = password ? ['passwort'] : ['login_name', 'login_link'];
  if (requiredTokens.some(key => !String(template.body || '').includes(`{{${key}}}`))) throw new Error(`E-Mail-Vorlage ${templateKey} enthält nicht alle benötigten Zugangsdaten.`);
  const subject = replace(template.subject, tokens);
  const body = replace(template.body, { ...tokens, passwort: password || '' });
  const rendered = renderBrandedEmail({ subject, body, ...appearance });
  // Mail clients do not always turn plain URLs into links; make the portal link explicit.
  const html = rendered.html.replace(loginUrl, `<a href="${loginUrl}" style="color:#087f79;font-weight:bold">${loginUrl}</a>`);
  // Never persist the one-time password in CRM communication history or logs.
  const safeBody = password ? 'Das Erstanmeldepasswort wurde in einer separaten E-Mail verschickt. Der Passwortinhalt wird aus Sicherheitsgründen nicht gespeichert.' : body;
  const safeRendered = password ? renderBrandedEmail({ subject, body: safeBody, ...appearance }) : { ...rendered, html };
  let record = existing;
  if (!record) record = (await rows(service, 'lead_communications', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ lead_id: lead.id, user_profile_id: profile.id, channel: 'email', direction: 'outbound', subject, body: safeRendered.text, body_html: safeRendered.html, preview: password ? 'Erstanmeldepasswort · Inhalt wird nicht gespeichert' : 'Benutzername und direkter Login-Link', recipient_email: profile.email, delivery_status: 'draft', signature_id: appearance.signature?.id || null, sent_by_name: 'CRM', attachments: [], automation_source: 'contract_signed', event_key: eventKey }) }))[0];
  const reserved = await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.${record.delivery_status}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ delivery_status: 'pending', updated_at: new Date().toISOString() }) });
  if (!reserved[0]) return 'check_mailbox';
  try {
    const sent = await sendMail({ to: profile.email, subject, text: rendered.text, html });
    await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: 'accepted', provider_message_id: sent.providerMessageId, sender_email: sent.senderEmail, occurred_at: new Date().toISOString(), updated_at: new Date().toISOString(), preview: password ? 'Erstanmeldepasswort · Von STRATO angenommen; Inhalt nicht gespeichert.' : 'Benutzername und Login-Link · Von STRATO angenommen.' }) });
    return 'accepted';
  } catch (error) {
    const certain = ['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error.code) || [400, 503].includes(error.status);
    await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: certain ? 'failed' : 'unknown', preview: certain ? 'STRATO-Versand fehlgeschlagen.' : 'Versandstatus unklar: Postfach vor erneutem Versuch prüfen.', updated_at: new Date().toISOString() }) }).catch(() => null);
    throw error;
  }
}

export async function sendPortalAccessEmails(service, { lead, profile, oneTimePassword }, { sendMail = sendPreparedMail, appearanceLoader = mailAppearance } = {}) {
  if (!lead?.id || !profile?.id || !profile?.email || !profile?.portal_username || !oneTimePassword || !profile?.one_time_password_issued_at) throw new Error('Die Portal-Zugangsdaten sind unvollständig.');
  const tokens = { vorname: String(profile.name || lead.name || '').trim().split(/\s+/)[0], login_name: profile.portal_username, login_link: loginUrl };
  const appearance = await appearanceLoader(service);
  const suffix = `${profile.id}:${profile.one_time_password_issued_at}`;
  const username = await sendOne(service, { lead, profile, templateKey: 'participant_access', eventKey: `portal-username:${suffix}`, tokens, appearance, sendMail });
  if (!['accepted', 'already_accepted'].includes(username)) return { username, password: 'waiting' };
  const password = await sendOne(service, { lead, profile, password: oneTimePassword, templateKey: 'participant_initial_password', eventKey: `portal-password:${suffix}`, tokens, appearance, sendMail });
  if (['accepted', 'already_accepted'].includes(password)) await rows(service, `user_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: 'PATCH', body: JSON.stringify({ access_invite_sent_at: new Date().toISOString() }) });
  return { username, password };
}
