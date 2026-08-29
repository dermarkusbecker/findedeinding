import { createSession, sessionCookie } from '../../lib/auth.js';
import { authenticateUser } from '../../lib/user-auth.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  try {
    const profile = await authenticateUser(request.body?.email, request.body?.password);
    const token = createSession(profile.email, profile.role, { userId: profile.auth_user_id, profileId: profile.id, participantId: profile.id, name: profile.name, email: profile.email, permissions: profile.permissions || [] });
    response.setHeader('Set-Cookie', sessionCookie(token));
    return response.status(200).json({ ok: true, destination: profile.role === 'admin' ? '/admin' : '/portal', user: { name: profile.name, email: profile.email, role: profile.role, permissions: profile.permissions || [] } });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Anmeldung fehlgeschlagen.' });
  }
}
