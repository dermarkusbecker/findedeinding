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
  if (profile.role === 'admin') return response.redirect(302, '/admin');
  if (profile.must_change_password === true) return response.redirect(302, '/login?change=required');
  if (profile.role !== 'user' || !profile.permissions?.some((permission) => ['customer_portal', 'clara_program'].includes(permission))) return response.redirect(302, '/login?error=access');
  const file = fileURLToPath(new URL('../portal.html', import.meta.url));
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  return response.status(200).send(readFileSync(file, 'utf8'));
}
