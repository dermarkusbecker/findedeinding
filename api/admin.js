import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFromRequest } from '../lib/auth.js';
import { profileById, supabaseAuthConfig } from '../lib/user-auth.js';

export default async function handler(request, response) {
  const session = sessionFromRequest(request);
  if (!session) return response.redirect(302, '/login');
  const config = supabaseAuthConfig();
  const profile = config && session.profileId ? await profileById(config, session.profileId).catch(() => null) : null;
  if (!profile || profile.status !== 'active') return response.redirect(302, '/login');
  if (profile.role !== 'admin') return response.redirect(302, '/portal');
  const file = fileURLToPath(new URL('../admin.html', import.meta.url));
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  return response.status(200).send(readFileSync(file, 'utf8'));
}
