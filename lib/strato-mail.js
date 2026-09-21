import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

// Credentials stay on the server. Fixed STRATO hosts prevent arbitrary connection targets.
export function stratoMailConfig(env = process.env) {
  const user = String(env.STRATO_MAILBOX_USER || '').trim();
  const pass = env.STRATO_MAILBOX_PASSWORD || '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) && pass ? { user, pass } : null;
}

function failure(error) {
  if (error?.code === 'EAUTH' || error?.authenticationFailed || error?.responseCode === 535) {
    return { ok: false, message: 'Anmeldung abgelehnt. Postfachadresse und Postfach-Passwort in Vercel prüfen.' };
  }
  if (['ETIMEDOUT', 'ETIMEOUT'].includes(error?.code)) {
    return { ok: false, message: 'Zeitüberschreitung beim Verbindungsaufbau. Bitte erneut prüfen.' };
  }
  return { ok: false, message: 'Verbindung nicht möglich. STRATO-Zugang und verschlüsselte Verbindung prüfen.' };
}

async function probe(createClient, run, timeoutMs) {
  let client;
  let timer;
  try {
    client = createClient();
    // IMAP can emit an error separately from the rejected connect promise.
    client.on?.('error', () => {});
    await Promise.race([
      run(client),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })), timeoutMs);
      }),
    ]);
    return { ok: true, message: 'Verschlüsselte Anmeldung erfolgreich.' };
  } catch (error) {
    // Never return provider errors: they may contain credentials or protocol data.
    return failure(error);
  } finally {
    clearTimeout(timer);
    try { client?.close(); } catch { /* Already disconnected. */ }
  }
}

export async function verifyStratoMailbox(config, {
  createSmtp = options => nodemailer.createTransport(options),
  createImap = options => new ImapFlow(options),
  timeoutMs = 15000,
} = {}) {
  if (!config) return { configured: false, ok: false, error: 'STRATO_MAILBOX_USER oder STRATO_MAILBOX_PASSWORD fehlt in der Produktionsumgebung.' };
  const common = {
    secure: true,
    auth: { user: config.user, pass: config.pass },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    logger: false,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  };
  const [smtp, imap] = await Promise.all([
    probe(() => createSmtp({ ...common, host: 'smtp.strato.de', port: 465, debug: false }), client => client.verify(), timeoutMs),
    probe(() => createImap({ ...common, host: 'imap.strato.de', port: 993, verifyOnly: true, includeMailboxes: false, logRaw: false, emitLogs: false }), client => client.connect(), timeoutMs),
  ]);
  return {
    configured: true, ok: smtp.ok && imap.ok, mailbox: config.user,
    checkedAt: new Date().toISOString(), smtp, imap,
    message: 'Nur die Anmeldung wurde geprüft. Es wurde keine E-Mail versendet oder importiert. CRM-Versand und Postfach-Synchronisierung werden im nächsten Einrichtungsschritt angebunden.',
  };
}
