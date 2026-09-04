const ALLOWED_STATUSES = new Set(['lead', 'qualified', 'proposal', 'won', 'lost']);
import { requireCurrentAdmin } from '../lib/user-auth.js';

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(request, response) {
  if (!await requireCurrentAdmin(request, response, 'leads')) return;
  const config = configuration();
  if (!config) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });

  if (request.method === 'GET') {
    const result = await fetch(
      `${config.url}/rest/v1/contacts?select=id,first_name,last_name,email,company,status,last_contact_at,created_at&order=created_at.desc&limit=100`,
      { headers: headers(config.key) },
    );
    const data = await result.json();
    return response.status(result.status).json(result.ok ? { contacts: data } : { error: data.message || 'Kontakte konnten nicht geladen werden.' });
  }

  if (request.method === 'POST') {
    const firstName = clean(request.body?.firstName, 80);
    const lastName = clean(request.body?.lastName, 80);
    const email = clean(request.body?.email, 254).toLowerCase();
    const company = clean(request.body?.company, 160);
    const status = clean(request.body?.status, 30) || 'lead';

    if (!firstName || !lastName) return response.status(400).json({ error: 'Vor- und Nachname sind erforderlich.' });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
    if (!ALLOWED_STATUSES.has(status)) return response.status(400).json({ error: 'Ungültiger Kontaktstatus.' });

    const result = await fetch(`${config.url}/rest/v1/contacts`, {
      method: 'POST',
      headers: headers(config.key, { Prefer: 'return=representation' }),
      body: JSON.stringify({ first_name: firstName, last_name: lastName, email: email || null, company: company || null, status }),
    });
    const data = await result.json();
    return response.status(result.status).json(result.ok ? { contact: data[0] } : { error: data.message || 'Kontakt konnte nicht gespeichert werden.' });
  }

  response.setHeader('Allow', 'GET, POST');
  return response.status(405).json({ error: 'Methode nicht erlaubt.' });
}
