import crypto from 'node:crypto';

const COOKIE = 'fdd_session';

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET ist nicht konfiguriert.');
  return process.env.AUTH_SECRET;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export const USER_PERMISSIONS = Object.freeze(['customer_portal', 'clara_program', 'documents', 'community']);

export function createSession(identity, role = 'user', claims = {}) {
  const permissions = role === 'admin' ? [...USER_PERMISSIONS] : USER_PERMISSIONS.filter((permission) => claims.permissions?.includes(permission));
  const payload = Buffer.from(JSON.stringify({ identity, role, ...claims, permissions, expires: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
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
    response.status(session ? 403 : 401).json({ error: session ? 'Nur für Administratoren.' : 'Nicht angemeldet.' });
    return null;
  }
  return session;
}

export function requireUser(request, response) {
  const session = sessionFromRequest(request);
  if (!session || !['admin', 'user'].includes(session.role)) {
    response.status(401).json({ error: 'Nicht angemeldet.' });
    return null;
  }
  return session;
}

export function requirePermission(permission) {
  if (!USER_PERMISSIONS.includes(permission)) throw new Error(`Unbekannte Berechtigung: ${permission}`);
  return (request, response) => {
    const session = requireUser(request, response);
    if (!session) return null;
    if (session.role === 'admin' || session.permissions?.includes(permission)) return session;
    response.status(403).json({ error: 'Für diesen Bereich fehlt die Freischaltung.' });
    return null;
  };
}

export const requireParticipant = requirePermission('clara_program');

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
