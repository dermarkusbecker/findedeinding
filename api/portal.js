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
  const portalVersion = '20260907-onboarding-consent-v2';
  const html = readFileSync(file, 'utf8')
    .replace('href="portal.css"', `href="portal.css?v=${portalVersion}"`)
    .replace('href="portal-access.css"', `href="portal-access.css?v=${portalVersion}"`)
    .replace('href="portal-journey.css"', `href="portal-journey.css?v=${portalVersion}"`)
    .replace('src="portal.js"', `src="portal.js?v=${portalVersion}"`);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-FDD-Portal-Version', portalVersion);
  return response.status(200).send(html);
}
