import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePortalSetupLink, sendPortalAccessEmails } from '../lib/portal-access-mail.js';

test('Vertragszugang versendet eine gestaltete Einrichtungs-Mail und protokolliert keinen geheimen Link', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const communications = new Map();
  const mails = [];
  const json = value => ({ ok: true, async json() { return value; } });
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const params = new URL(url).searchParams;
    requests.push({ path, method: options.method || 'GET', body: options.body || '' });
    if (path.endsWith('/communication_templates')) return json([{ subject: 'Dein Zugang', body: 'Hallo {{vorname}},\n\nBenutzername: {{login_name}}\nE-Mail: {{email}}\n\n{{setup_link}}' }]);
    if (path.endsWith('/lead_communications') && !options.method) return json([...communications.values()].filter(item => item.event_key === params.get('event_key')?.slice(3)));
    if (path.endsWith('/lead_communications') && options.method === 'POST') {
      const record = { ...JSON.parse(options.body), id: String(communications.size + 1) };
      communications.set(record.id, record);
      return json([record]);
    }
    if (path.endsWith('/lead_communications') && options.method === 'PATCH') {
      const record = communications.get(params.get('id').slice(3));
      if (record.delivery_status !== params.get('delivery_status')?.slice(3)) return json([]);
      Object.assign(record, JSON.parse(options.body));
      return json([record]);
    }
    if (path.endsWith('/user_profiles') && options.method === 'PATCH') return json([]);
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const input = { lead: { id: 'lead-1', name: 'Marius Mustermann' }, profile: { id: 'profile-1', name: 'Marius Mustermann', email: 'marius@example.de', portal_username: 'Marius_KD10001', one_time_password_issued_at: '2026-10-08T12:00:00Z' } };
    const secretLink = 'https://example.supabase.co/auth/v1/verify?token=secret-token&type=recovery&redirect_to=https%3A%2F%2Ffindedeinding.com%2Flogin%3Fsetup%3D1';
    const dependencies = { appearanceLoader: async () => ({ signature: { active: true, signer_name: 'Markus Becker', company_name: 'Finde dein Ding', closing_text: 'Viele Grüße' }, branding: { brand_name: 'Finde dein Ding' } }), linkGenerator: async () => secretLink, sendMail: async mail => { mails.push(mail); return { senderEmail: 'markus@dermarkusbecker.de', providerMessageId: `mail-${mails.length}` }; } };
    const result = await sendPortalAccessEmails({ url: 'https://example.supabase.co', key: 'test-key' }, input, dependencies);
    assert.deepEqual(result, { setup: 'accepted' });
    assert.equal(requests.find(item => item.path.endsWith('/communication_templates'))?.path, '/rest/v1/communication_templates');
    assert.equal(mails.length, 1);
    assert.match(mails[0].html, /Passwort jetzt festlegen/);
    assert.match(mails[0].text, /Marius_KD10001/);
    assert.match(mails[0].text, /marius@example.de/);
    assert.match(mails[0].text, /secret-token/);
    assert.match(mails[0].html, /Markus Becker/);
    assert.equal(JSON.stringify(requests).includes('secret-token'), false);
    assert.equal([...communications.values()].every(item => item.delivery_status === 'accepted'), true);
    assert.equal(requests.some(item => item.path.endsWith('/user_profiles') && JSON.parse(item.body).access_invite_sent_at), true);
    const second = await sendPortalAccessEmails({ url: 'https://example.supabase.co', key: 'test-key' }, input, dependencies);
    assert.equal(second.setup, 'already_accepted');
    assert.equal(mails.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Einrichtungslink wird vom Auth-Dienst erzeugt und muss zum Portal zurückführen', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const destination = 'https://findedeinding.com/login?setup=1';
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { type: 'recovery', email: 'kunde@example.de', redirect_to: destination });
    return Response.json({ action_link: `https://db.example/auth/v1/verify?token=secret&type=recovery&redirect_to=${encodeURIComponent(destination)}` });
  };
  assert.match(await generatePortalSetupLink({ url: 'https://db.example', key: 'test' }, 'kunde@example.de'), /token=secret/);
  globalThis.fetch = async () => Response.json({ action_link: 'https://evil.example/auth/v1/verify?token=secret&type=recovery' });
  await assert.rejects(generatePortalSetupLink({ url: 'https://db.example', key: 'test' }, 'kunde@example.de'), /führt nicht zum Kundenportal/);
});
