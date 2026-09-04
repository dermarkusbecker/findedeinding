import crypto from 'node:crypto';
import { supabaseAuthConfig } from '../lib/user-auth.js';

export const config = { api: { bodyParser: false } };

const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
const digits = (value) => String(value || '').replace(/\D/g, '');
const comparablePhone = (value) => digits(value).slice(-10);

async function rawBody(request) {
  if (typeof request.body === 'string') return Buffer.from(request.body);
  if (Buffer.isBuffer(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function validSignature(buffer, signature) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(buffer).digest('hex')}`;
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function json(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error(data.message || data.error || fallback);
  return data;
}

async function storeIncoming(service, message) {
  const sender = comparablePhone(message.from);
  if (!sender) return;
  const profiles = await json(await fetch(`${service.url}/rest/v1/user_profiles?role=eq.user&select=id,phone,mobile_phone,whatsapp_phone&limit=2000`, { headers: headers(service.key) }), 'Kunden konnten nicht zugeordnet werden.');
  const profile = profiles.find((item) => [item.whatsapp_phone, item.mobile_phone, item.phone].some((phone) => comparablePhone(phone) === sender));
  if (!profile) return;
  const leads = await json(await fetch(`${service.url}/rest/v1/leads?converted_user_profile_id=eq.${encodeURIComponent(profile.id)}&select=id&limit=1`, { headers: headers(service.key) }), 'Kundenakte konnte nicht zugeordnet werden.');
  if (!leads[0]) return;
  const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.document?.filename || message.image?.caption || `[${message.type || 'WhatsApp-Nachricht'}]`;
  const occurredAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();
  const result = await fetch(`${service.url}/rest/v1/lead_communications?on_conflict=provider_message_id`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=ignore-duplicates,return=minimal' }), body: JSON.stringify({ lead_id: leads[0].id, direction: 'inbound', channel: 'whatsapp', subject: 'WhatsApp Business', preview: String(text).slice(0, 500), body: String(text).slice(0, 10000), delivery_status: 'received', provider_message_id: message.id || null, occurred_at: occurredAt, updated_at: new Date().toISOString() }) });
  if (!result.ok) throw new Error('WhatsApp-Eingang konnte nicht gespeichert werden.');
}

export default async function handler(request, response) {
  if (request.method === 'GET') {
    const valid = request.query?.['hub.mode'] === 'subscribe' && request.query?.['hub.verify_token'] === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    return valid ? response.status(200).send(request.query?.['hub.challenge'] || '') : response.status(403).send('Webhook-Verifizierung fehlgeschlagen.');
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  try {
    const buffer = await rawBody(request);
    if (!validSignature(buffer, request.headers['x-hub-signature-256'])) return response.status(401).json({ error: 'Ungültige WhatsApp-Signatur.' });
    const payload = JSON.parse(buffer.toString('utf8'));
    const auth = supabaseAuthConfig();
    if (!auth) return response.status(503).json({ error: 'Supabase ist nicht konfiguriert.' });
    const service = { ...auth, key: auth.serviceKey };
    const messages = (payload.entry || []).flatMap((entry) => entry.changes || []).flatMap((change) => change.value?.messages || []);
    await Promise.all(messages.map((message) => storeIncoming(service, message)));
    return response.status(200).json({ ok: true, received: messages.length });
  } catch (error) {
    return response.status(400).json({ error: error.message || 'WhatsApp-Webhook konnte nicht verarbeitet werden.' });
  }
}
