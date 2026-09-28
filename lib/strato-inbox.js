import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { stratoMailConfig } from './strato-mail.js';

const headers = key => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');

export async function syncStratoInbox(service, {
  mailbox = stratoMailConfig(),
  createClient = options => new ImapFlow(options),
  request = fetch,
  parse = simpleParser,
  limit = 50,
} = {}) {
  if (!mailbox) throw Object.assign(new Error('STRATO-Postfachzugang fehlt.'), { status: 503 });
  const contactsResponse = await request(`${service.url}/rest/v1/leads?select=id,email&limit=10000`, { headers: headers(service.key) });
  if (!contactsResponse.ok) throw Object.assign(new Error('CRM-Kontakte konnten nicht geladen werden.'), { status: 503 });
  const contacts = new Map((await contactsResponse.json()).filter(row => validEmail(row.email)).map(row => [row.email.toLowerCase(), row.id]));
  const client = createClient({ host: 'imap.strato.de', port: 993, secure: true,
    auth: mailbox, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  client.on?.('error', () => {});
  let imported = 0, matched = 0, inspected = 0;
  try {
    await client.connect();
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const count = Number(box.exists || 0);
    if (count) {
      const start = Math.max(1, count - Math.min(Math.max(limit, 1), 200) + 1);
      const recent = [];
      for await (const item of client.fetch(`${start}:*`, { envelope: true, internalDate: true, uid: true })) recent.push(item);
      for (const item of recent) {
        inspected++;
        const from = String(item.envelope?.from?.[0]?.address || '').toLowerCase();
        const leadId = contacts.get(from);
        if (!leadId) continue;
        matched++;
        const source = await client.fetchOne(item.uid, { source: true }, { uid: true });
        if (!source?.source) continue;
        const parsed = await parse(source.source, { skipHtmlToText: false, skipTextToHtml: true });
        const key = `strato:in:${mailbox.user}:${box.uidValidity}:${item.uid}`;
        const subject = String(parsed.subject || item.envelope?.subject || 'Ohne Betreff').slice(0, 300);
        const body = String(parsed.text || '').trim().slice(0, 50000);
        const occurred = item.internalDate instanceof Date && !Number.isNaN(item.internalDate.getTime()) ? item.internalDate.toISOString() : new Date().toISOString();
        const response = await request(`${service.url}/rest/v1/lead_communications?on_conflict=provider_message_id`, {
          method: 'POST', headers: { ...headers(service.key), Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify({ lead_id: leadId, direction: 'inbound', channel: 'email', subject, body,
            preview: body.slice(0, 500) || '(Nachricht ohne lesbaren Text)', delivery_status: 'received',
            provider_message_id: key, occurred_at: occurred }),
        });
        if (!response.ok) throw Object.assign(new Error('Eingangsmail konnte nicht im CRM gespeichert werden.'), { status: 503 });
        imported += (await response.json()).length;
      }
    }
    return { ok: true, imported, matched, inspected, mailbox: mailbox.user, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('STRATO-Posteingang konnte nicht synchronisiert werden. Postfachzugang prüfen.'), { status: 503 });
  } finally {
    try { await client.logout(); } catch { try { client.close(); } catch {} }
  }
}
