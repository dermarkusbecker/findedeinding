import { sendPasswordReset, supabaseAuthConfig } from '../../lib/user-auth.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Der Login ist noch nicht vollständig konfiguriert.' });
  try {
    await sendPasswordReset(config, request.body?.email);
    return response.status(200).json({ ok: true, message: 'Wenn ein Konto existiert, wurde eine E-Mail zum Zurücksetzen versendet.' });
  } catch (error) {
    if (error.status === 400) return response.status(400).json({ error: error.message });
    return response.status(200).json({ ok: true, message: 'Wenn ein Konto existiert, wurde eine E-Mail zum Zurücksetzen versendet.' });
  }
}
