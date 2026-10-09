import test from 'node:test';
import assert from 'node:assert/strict';
import authHandler from '../api/auth.js';

const responseMock = () => ({ statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; } });

test('Kunde setzt Passwort über Einmal-Link und gelangt ohne zweiten Login ins Portal', async t => {
  const previous = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'AUTH_SECRET'].map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters' });
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/v1/user' && !options.method) return Response.json({ id: 'auth-user' });
    if (path === '/rest/v1/user_profiles' && !options.method) return Response.json([{ id: 'profile-1', auth_user_id: 'auth-user', name: 'Marius Muster', email: 'marius@example.de', role: 'user', status: 'active', permissions: ['customer_portal'] }]);
    if (options.method === 'PUT' && path === '/auth/v1/user') { writes.push({ path, body: JSON.parse(options.body) }); return Response.json({ id: 'auth-user' }); }
    if (options.method === 'PATCH' && path === '/rest/v1/user_profiles') { writes.push({ path, body: JSON.parse(options.body) }); return Response.json([]); }
    throw new Error(`Unexpected request: ${path}`);
  };
  const response = responseMock();
  await authHandler({ method: 'POST', query: { action: 'update-password' }, body: { accessToken: 'single-use-recovery-token', password: 'MeinNeuesPasswort123!' } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.destination, '/portal');
  assert.match(response.headers['Set-Cookie'], /fdd_session=/);
  assert.deepEqual(writes[0].body, { password: 'MeinNeuesPasswort123!' });
  assert.equal(writes[1].body.must_change_password, false);
});
