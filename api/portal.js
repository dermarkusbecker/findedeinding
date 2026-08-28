import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFromRequest } from '../lib/auth.js';

export default function handler(request, response) {
  if (!sessionFromRequest(request)) return response.redirect(302, '/login');
  const file = fileURLToPath(new URL('../portal.html', import.meta.url));
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  return response.status(200).send(readFileSync(file, 'utf8'));
}
