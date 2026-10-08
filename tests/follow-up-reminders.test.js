import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFollowUpCron } from '../lib/follow-up-reminders.js';

test('fälliges Follow-up erzeugt im Benachrichtigungsmodus genau einen Hinweis', async t => {
  const originalFetch = global.fetch;
  const names = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CRON_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { global.fetch = originalFetch; for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; });
  Object.assign(process.env, { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', CRON_SECRET: 'secret' });
  let created = false;
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/follow_up_settings')) return Response.json([{ reminder_channel: 'notification', recipient_email: 'markus@dermarkusbecker.de' }]);
    if (path.endsWith('/lead_tasks')) return Response.json([{ id: 'task-1', lead_id: 'lead-1', due_at: '2026-10-01', completed: false }]);
    if (path.endsWith('/leads')) return Response.json([{ id: 'lead-1', name: 'Max Muster', email: 'max@example.test', phone: '+4912345678', status: 'later', converted_user_profile_id: null }]);
    if (path.endsWith('/follow_up_notifications') && options.method === 'POST') { const inserted = !created; created = true; return Response.json(inserted ? [{ id: 'notice-1' }] : []); }
    throw new Error(`Unexpected request: ${url}`);
  };
  const run = async () => { let code = 200, result; await handleFollowUpCron({ method: 'GET', headers: { authorization: 'Bearer secret' } }, { setHeader() {}, status(value) { code = value; return this; }, json(value) { result = value; return this; } }); return { code, result }; };
  assert.deepEqual((await run()).result, { ok: true, channel: 'notification', sent: 0, notified: 1, skipped: 0 });
  assert.deepEqual((await run()).result, { ok: true, channel: 'notification', sent: 0, notified: 0, skipped: 1 });
  assert.equal((await run()).code, 200);
});
