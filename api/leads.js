function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
import { requireCurrentAdmin } from '../lib/user-auth.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export default async function handler(request, response) {
  const service = config();
  if (request.method === 'GET') {
    if (!await requireCurrentAdmin(request, response)) return;
    if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
    const result = await fetch(`${service.url}/rest/v1/leads?select=*&order=created_at.desc&limit=200`, { headers: { apikey: service.key, Authorization: `Bearer ${service.key}` } });
    const leads = await result.json();
    return response.status(result.status).json(result.ok ? { leads } : { error: leads.message || 'Leads konnten nicht geladen werden.' });
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  if (request.body?.website) return response.status(200).json({ ok: true });
  if (!service) return response.status(503).json({ error: 'Lead-Erfassung ist noch nicht konfiguriert.' });
  const name = clean(request.body?.name, 120);
  const email = clean(request.body?.email, 254).toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: 'Bitte Name und gültige E-Mail-Adresse eingeben.' });
  const payload = {
    name, email, phone: clean(request.body?.phone, 40) || null,
    challenge: clean(request.body?.challenge, 500) || null,
    source: clean(request.body?.source, 80) || 'website',
    utm_source: clean(request.body?.utm_source, 100) || null,
    utm_medium: clean(request.body?.utm_medium, 100) || null,
    utm_campaign: clean(request.body?.utm_campaign, 150) || null,
    consent_at: request.body?.consent ? new Date().toISOString() : null,
  };
  if (!payload.consent_at) return response.status(400).json({ error: 'Bitte bestätige die Datenschutzhinweise.' });
  const result = await fetch(`${service.url}/rest/v1/leads`, { method: 'POST', headers: { apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
  if (!result.ok) { const error = await result.json(); return response.status(result.status).json({ error: error.message || 'Lead konnte nicht gespeichert werden.' }); }
  return response.status(201).json({ ok: true });
}
