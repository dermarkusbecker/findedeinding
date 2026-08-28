import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFromRequest } from '../lib/auth.js';

export default function handler(request, response) {
  const session = sessionFromRequest(request);
  if (!session || !['participant', 'admin'].includes(session.role)) return response.redirect(302, '/kunden-login');
  const file = fileURLToPath(new URL('../portal.html', import.meta.url));
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  return response.status(200).send(readFileSync(file, 'utf8'));
}
