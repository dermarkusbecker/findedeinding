import { cronAuthorized } from './dunning-api.js';
import { supabaseAuthConfig } from './user-auth.js';
import { mailAppearance, sendPreparedMail } from './branded-mail-service.js';
import { renderBrandedEmail } from './branded-email.js';

const berlinDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const headers = service => ({ apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json' });
async function query(service, path, options = {}) {
  const response = await fetch(`${service.url}/rest/v1/${path}`, { ...options, headers: { ...headers(service), ...(options.headers || {}) } });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.message || 'Follow-up konnte nicht verarbeitet werden.');
  return data;
}
export async function followUpSettings(service) {
  const rows = await query(service, 'follow_up_settings?id=eq.default&select=*&limit=1');
  return rows[0] || { id: 'default', reminder_channel: 'email', recipient_email: 'markus@dermarkusbecker.de' };
}
export async function handleFollowUpCron(request, response) {
  response.setHeader('Cache-Control', 'private, no-store');
  if (!cronAuthorized(request)) return response.status(401).json({ error: 'Nicht autorisiert.' });
  if (request.method !== 'GET') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const auth = supabaseAuthConfig();
  if (!auth?.serviceKey) return response.status(503).json({ error: 'Datenbankverbindung fehlt.' });
  const service = { ...auth, key: auth.serviceKey };
  try {
    const settings = await followUpSettings(service);
    const tasks = await query(service, `lead_tasks?task_type=eq.lead_follow_up&completed=eq.false&due_at=lte.${berlinDay()}&select=*&order=due_at.asc&limit=200`);
    let sent = 0, notified = 0, skipped = 0;
    for (const task of tasks) {
      const lead = (await query(service, `leads?id=eq.${encodeURIComponent(task.lead_id)}&select=id,name,email,phone,mobile_phone,status,converted_user_profile_id&limit=1`))[0];
      if (!lead || lead.status !== 'later' || lead.converted_user_profile_id) { skipped++; continue; }
      const date = task.due_at.split('-').reverse().join('.');
      const subject = `Follow-up heute: ${lead.name}`;
      const body = `Hallo Markus,\n\nfür ${lead.name} steht heute (${date}) ein Follow-up an. Bitte kontaktiere diesen Interessenten.\n\nTelefon: ${lead.mobile_phone || lead.phone || 'Nicht hinterlegt'}\nE-Mail: ${lead.email || 'Nicht hinterlegt'}\n\nDie Kontaktdaten und den bisherigen Verlauf findest du in der Interessentenakte.`;
      if (settings.reminder_channel === 'notification') {
        const created = await query(service, 'follow_up_notifications?on_conflict=task_id,due_at', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ lead_id: lead.id, task_id: task.id, due_at: task.due_at, title: subject, body }) });
        if (created.length) notified++; else skipped++;
        continue;
      }
      const eventKey = `follow-up:${task.id}:${task.due_at}`;
      const recipient = settings.recipient_email;
      let record = (await query(service, `lead_communications?event_key=eq.${encodeURIComponent(eventKey)}&select=*&limit=1`))[0];
      if (!record) {
        const appearance = await mailAppearance(service);
        const rendered = renderBrandedEmail({ subject, body, ...appearance });
        const inserted = await query(service, 'lead_communications?on_conflict=event_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ lead_id: lead.id, direction: 'outbound', channel: 'email', recipient_email: recipient, subject, body: rendered.text, body_html: rendered.html, preview: `Follow-up ${date} · ${lead.name}`, delivery_status: 'draft', automation_source: 'follow_up_reminder', event_key: eventKey, signature_id: appearance.signature?.id || null, sent_by_name: 'CRM' }) });
        record = inserted[0];
      }
      if (!record || !['draft', 'failed'].includes(record.delivery_status)) { skipped++; continue; }
      const reserved = await query(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.${record.delivery_status}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ delivery_status: 'pending', updated_at: new Date().toISOString() }) });
      if (!reserved[0]) { skipped++; continue; }
      try {
        const mail = await sendPreparedMail({ to: recipient, subject: record.subject, text: record.body, html: record.body_html });
        await query(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: 'accepted', provider_message_id: mail.providerMessageId, sender_email: mail.senderEmail, occurred_at: new Date().toISOString(), updated_at: new Date().toISOString(), preview: 'Follow-up-Erinnerung von STRATO angenommen; Zustellung nicht bestätigt.' }) });
        sent++;
      } catch (error) {
        const certain = ['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error.code) || [400, 503].includes(error.status);
        await query(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: certain ? 'failed' : 'unknown', preview: certain ? 'STRATO-Versand fehlgeschlagen.' : 'Versandstatus unklar; STRATO-Postfach prüfen.', updated_at: new Date().toISOString() }) });
        skipped++;
      }
    }
    return response.status(200).json({ ok: true, channel: settings.reminder_channel, sent, notified, skipped });
  } catch (error) {
    return response.status(503).json({ error: error.message });
  }
}
