import nodemailer from 'nodemailer';
import { renderBrandedEmail } from './branded-email.js';
import { stratoMailConfig } from './strato-mail.js';

const FALLBACK_SIGNATURE = Object.freeze({
  active: true,
  closing_text: 'Herzliche Grüße',
  signer_name: 'Markus Becker',
  role_title: 'Gründer & Klarheitsbegleiter',
  company_name: 'Finde dein Ding',
  website: 'findedeinding.de',
  use_system_logo: true,
});

export async function mailAppearance(service, request = fetch) {
  const key = service.serviceKey || service.key;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const paths = [
    'communication_signatures?active=eq.true&is_default=eq.true&select=*&limit=1',
    'system_branding?id=eq.default&select=*&limit=1',
  ];
  const [signatures, brands] = await Promise.all(paths.map(async path => {
    const response = await request(`${service.url}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Mail-Design und Signatur konnten nicht geladen werden.');
    return response.json();
  }));
  return { signature: signatures[0] || FALLBACK_SIGNATURE, branding: brands[0] || { brand_name: 'Finde dein Ding' } };
}

export async function sendBrandedMail(service, { to, subject, body, appearance, messageId }, {
  mailbox = stratoMailConfig(),
  transportFactory = options => nodemailer.createTransport(options),
  request = fetch,
} = {}) {
  if (!mailbox) throw Object.assign(new Error('Der STRATO-Postfachzugang ist nicht konfiguriert.'), { status: 503 });
  if (!/^\S+@\S+\.\S+$/.test(to || '') || !subject || !body) throw Object.assign(new Error('Empfänger, Betreff und Nachricht fehlen.'), { status: 400 });
  const theme = appearance || await mailAppearance(service, request);
  const rendered = renderBrandedEmail({ subject, body, ...theme });
  const sent = await sendPreparedMail({ to, subject, ...rendered, messageId }, { mailbox, transportFactory });
  return { ...rendered, ...sent };
}

export async function sendPreparedMail({ to, subject, text, html, messageId }, {
  mailbox = stratoMailConfig(),
  transportFactory = options => nodemailer.createTransport(options),
} = {}) {
  if (!mailbox) throw Object.assign(new Error('Der STRATO-Postfachzugang ist nicht konfiguriert.'), { status: 503 });
  if (!/^\S+@\S+\.\S+$/.test(to || '') || !subject || !text || !html) throw Object.assign(new Error('Die vorbereitete Nachricht ist unvollständig.'), { status: 400 });
  const transport = transportFactory({
    host: 'smtp.strato.de', port: 465, secure: true,
    auth: mailbox, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  try {
    const info = await transport.sendMail({
      from: { name: 'Finde dein Ding', address: mailbox.user },
      to, subject, text, html,
      ...(messageId ? { messageId } : {}),
      disableFileAccess: true,
    });
    if (Array.isArray(info?.accepted) && !info.accepted.some(address => address.toLowerCase() === to.toLowerCase())) {
      throw new Error('STRATO hat die Nachricht nicht für den Empfänger angenommen.');
    }
    return { providerMessageId: info?.messageId || messageId || null };
  } finally {
    transport.close();
  }
}
