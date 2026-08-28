import crypto from 'node:crypto';

const COOKIE = 'fdd_session';

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET ist nicht konfiguriert.');
  return process.env.AUTH_SECRET;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSession(username, role = 'admin') {
  const payload = Buffer.from(JSON.stringify({ username, role, expires: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function sessionFromRequest(request) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE.length + 1);
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.expires > Date.now() ? session : null;
  } catch { return null; }
}

export function requireAdmin(request, response) {
  const session = sessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    response.status(401).json({ error: 'Nicht angemeldet.' });
    return null;
  }
  return session;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
