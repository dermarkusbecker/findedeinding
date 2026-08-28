import crypto from 'node:crypto';
import { createSession, sessionCookie } from '../../lib/auth.js';

function equal(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword || !process.env.AUTH_SECRET) return response.status(503).json({ error: 'Der Admin-Login ist noch nicht konfiguriert.' });
  if (!equal(request.body?.username, expectedUser) || !equal(request.body?.password, expectedPassword)) {
    return response.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
  }
  response.setHeader('Set-Cookie', sessionCookie(createSession(expectedUser)));
  return response.status(200).json({ ok: true, user: { username: expectedUser, role: 'admin' } });
}
