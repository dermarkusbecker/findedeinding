import test from 'node:test';
import assert from 'node:assert/strict';
import { syncStratoInbox } from '../lib/strato-inbox.js';

test('STRATO inbox imports only known contacts and keeps repeated sync idempotent', async () => {
  const stored = new Set();
  const added = [];
  let connectionOptions;
  const createClient = options => {
    connectionOptions = options;
    return {
      on() {}, async connect() {}, async mailboxOpen(name, options) {
        assert.equal(name, 'INBOX'); assert.equal(options.readOnly, true);
        return { exists: 2, uidValidity: 12n };
      },
      async *fetch() {
        for (const [uid, address] of [[1, 'kunde@example.test'], [2, 'unbekannt@example.test']]) {
          yield { uid, envelope: { from: [{ address }], subject: 'Antwort' }, internalDate: new Date('2026-09-28T10:00:00Z') };
        }
      },
      async fetchOne(uid) { assert.equal(uid, 1); return { source: Buffer.from('From: kunde@example.test\r\nTo: info@example.test\r\nSubject: Antwort\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag, ich bestaetige den Termin.') }; },
      async logout() {},
    };
  };
  const request = async (url, options) => {
    if (url.includes('/leads?')) return Response.json([{ id: 'lead-1', email: 'kunde@example.test' }]);
    const record = JSON.parse(options.body);
    assert.equal(record.direction, 'inbound');
    assert.equal(record.lead_id, 'lead-1');
    assert.equal(record.provider_message_id, 'strato:in:info@example.test:12:1');
    assert.match(record.body, /bestaetige den Termin/);
    const fresh = !stored.has(record.provider_message_id);
    stored.add(record.provider_message_id);
    if (fresh) added.push(record);
    return Response.json(fresh ? [record] : [], { status: fresh ? 201 : 200 });
  };
  const input = { mailbox: { user: 'info@example.test', pass: 'test' }, createClient, request };
  const service = { url: 'https://example.test', key: 'secret' };
  const first = await syncStratoInbox(service, input);
  const second = await syncStratoInbox(service, input);
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(added.length, 1);
  assert.equal(connectionOptions.host, 'imap.strato.de');
  assert.equal(connectionOptions.port, 993);
});
