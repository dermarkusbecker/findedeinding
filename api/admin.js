import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionFromRequest } from '../lib/auth.js';
import { profileById, supabaseAuthConfig } from '../lib/user-auth.js';

export default async function handler(request, response) {
  if (request.query?.action === 'health') {
    const supabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    const auth = Boolean(process.env.AUTH_SECRET && process.env.ADMIN_PASSWORD);
    return response.status(supabase && auth ? 200 : 503).json({ ok: supabase && auth, services: { vercel: true, supabase, auth } });
  }
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
