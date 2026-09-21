import test from 'node:test';
import assert from 'node:assert/strict';
import { stratoMailConfig, verifyStratoMailbox } from '../lib/strato-mail.js';
import { buildSystemRegistry } from '../lib/system-registry.js';

const config = { user: 'markus@example.com', pass: 'password-with-spaces ' };

test('STRATO requires a complete mailbox and preserves the exact password', async () => {
  assert.equal(stratoMailConfig({ STRATO_MAILBOX_PASSWORD: 'secret' }), null);
  assert.equal(stratoMailConfig({ STRATO_MAILBOX_USER: 'invalid', STRATO_MAILBOX_PASSWORD: 'secret' }), null);
  assert.deepEqual(stratoMailConfig({ STRATO_MAILBOX_USER: ` ${config.user} `, STRATO_MAILBOX_PASSWORD: config.pass }), config);
  const result = await verifyStratoMailbox(null, { createSmtp() { throw new Error('Must not connect'); } });
  assert.equal(result.configured, false);
});

test('STRATO checks both logins with TLS, without sending or reading mail, and closes connections', async () => {
  const options = {};
  const closed = [];
  const result = await verifyStratoMailbox(config, {
    createSmtp(value) { options.smtp = value; return { verify: async () => true, close: () => closed.push('smtp') }; },
    createImap(value) { options.imap = value; return { connect: async () => true, close: () => closed.push('imap') }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(closed.sort(), ['imap', 'smtp']);
  assert.equal(options.smtp.host, 'smtp.strato.de');
  assert.equal(options.smtp.port, 465);
  assert.equal(options.imap.host, 'imap.strato.de');
  assert.equal(options.imap.port, 993);
  assert.equal(options.imap.verifyOnly, true);
  assert.equal(options.imap.includeMailboxes, false);
  for (const value of Object.values(options)) {
    assert.equal(value.secure, true);
    assert.equal(value.tls.rejectUnauthorized, true);
    assert.equal(value.logger, false);
    assert.deepEqual(value.auth, config);
  }
  assert.equal(JSON.stringify(result).includes(config.pass), false);
});

test('STRATO reports partial failure without disclosing provider errors or passwords', async () => {
  const result = await verifyStratoMailbox(config, {
    createSmtp: () => ({ verify: async () => { throw Object.assign(new Error(config.pass), { code: 'EAUTH' }); }, close() {} }),
    createImap: () => ({ connect: async () => true, close() {} }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.smtp.ok, false);
  assert.equal(result.imap.ok, true);
  assert.match(result.smtp.message, /Anmeldung abgelehnt/);
  assert.equal(JSON.stringify(result).includes(config.pass), false);
});

test('STRATO terminates hanging checks and closes both clients', async () => {
  let closed = 0;
  const never = () => new Promise(() => {});
  const result = await verifyStratoMailbox(config, {
    timeoutMs: 10,
    createSmtp: () => ({ verify: never, close() { closed++; } }),
    createImap: () => ({ connect: never, close() { closed++; } }),
  });
  assert.equal(result.ok, false);
  assert.equal(closed, 2);
  assert.match(result.smtp.message, /Zeitüberschreitung/);
  assert.match(result.imap.message, /Zeitüberschreitung/);
});

test('STRATO configured credentials are not displayed as an active mail transport', () => {
  const registry = buildSystemRegistry({ mailConfigured: true, mailUser: config.user });
  const mail = registry.integrations.find(item => item.id === 'domain_email');
  assert.equal(mail.status.key, 'ready');
  assert.equal(mail.action, 'strato-mail-check');
  assert.match(mail.detail, /noch nicht aktiviert/);
});
