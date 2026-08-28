import { clearSessionCookie, sessionFromRequest } from '../../lib/auth.js';

export default function handler(request, response) {
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearSessionCookie());
    return response.status(200).json({ ok: true });
  }
  const session = sessionFromRequest(request);
  return session ? response.status(200).json({ authenticated: true, user: session }) : response.status(401).json({ authenticated: false });
}
