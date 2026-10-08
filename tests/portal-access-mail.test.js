import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPortalAccessEmails } from '../lib/portal-access-mail.js';

test('Vertragszugang versendet getrennte, gestaltete Mails und protokolliert kein Passwort', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const communications = new Map();
  const mails = [];
  const json = value => ({ ok: true, async json() { return value; } });
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const params = new URL(url).searchParams;
    requests.push({ path, method: options.method || 'GET', body: options.body || '' });
    if (path.endsWith('/communication_templates')) {
      const key = params.get('template_key').slice(3);
      return json([{ subject: key === 'participant_access' ? 'Dein Zugang' : 'Dein Passwort', body: key === 'participant_access' ? 'Hallo {{vorname}},\n\nBenutzername: {{login_name}}\n\n{{login_link}}' : 'Hallo {{vorname}},\n\nErstanmeldepasswort: {{passwort}}' }]);
    }
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
    const input = { lead: { id: 'lead-1', name: 'Marius Mustermann' }, profile: { id: 'profile-1', name: 'Marius Mustermann', email: 'marius@example.de', portal_username: 'Marius_KD10001', one_time_password_issued_at: '2026-10-08T12:00:00Z' }, oneTimePassword: 'SecretStartPassword123!' };
    const dependencies = { appearanceLoader: async () => ({ signature: { active: true, signer_name: 'Markus Becker', company_name: 'Finde dein Ding', closing_text: 'Viele Grüße' }, branding: { brand_name: 'Finde dein Ding' } }), sendMail: async mail => { mails.push(mail); return { senderEmail: 'markus@dermarkusbecker.de', providerMessageId: `mail-${mails.length}` }; } };
    const result = await sendPortalAccessEmails({ url: 'https://example.supabase.co', key: 'test-key' }, input, dependencies);
    assert.deepEqual(result, { username: 'accepted', password: 'accepted' });
    assert.equal(mails.length, 2);
    assert.match(mails[0].html, /href="https:\/\/findedeinding.com\/login\?bereich=kunde"/);
    assert.match(mails[0].text, /Marius_KD10001/);
    assert.match(mails[1].text, /SecretStartPassword123!/);
    assert.match(mails[1].html, /Markus Becker/);
    assert.equal(JSON.stringify(requests).includes('SecretStartPassword123!'), false);
    assert.equal([...communications.values()].every(item => item.delivery_status === 'accepted'), true);
    assert.equal(requests.some(item => item.path.endsWith('/user_profiles') && JSON.parse(item.body).access_invite_sent_at), true);
    const second = await sendPortalAccessEmails({ url: 'https://example.supabase.co', key: 'test-key' }, input, dependencies);
    assert.equal(second.password, 'already_accepted');
    assert.equal(mails.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});
