import crypto from 'node:crypto';
import { customerAccount } from './customer-account.js';
import { mailAppearance, sendPreparedMail } from './branded-mail-service.js';
import { renderBrandedEmail } from './branded-email.js';

const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cents = value => Math.round(Number(value || 0) * 100);
const appUrl = () => (process.env.PUBLIC_SITE_URL || 'https://findedeinding.vercel.app').replace(/\/$/, '');
export const stripeReady = () => Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'));

export async function stripeRequest(path, form, request = fetch) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw fail('Stripe ist noch nicht verbunden. Der geheime API-Schlüssel fehlt.', 503);
  const result = await request(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15000),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw fail(data.error?.message || 'Stripe konnte die Zahlung nicht vorbereiten.', 502);
  return data;
}

export function paymentAllocations(account, selectedInvoiceId = '') {
  if (selectedInvoiceId && !uuid(selectedInvoiceId)) throw fail('Ungültige Rechnung.');
  if (account.summary.customerCredit > 0) throw fail('Das Kundenkonto enthält unverrechnete Zahlungen oder Guthaben. Bitte zuerst im CRM zuordnen.', 409);
  const invoices = account.invoices.filter(i => i.open > 0 && (!selectedInvoiceId || i.id === selectedInvoiceId))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
  if (!invoices.length) throw fail('Keine offene Rechnung vorhanden.', 409);
  return invoices.map(i => ({ invoiceId: i.id, amountCents: cents(i.open), number: i.invoice_number, description: i.description }));
}

export async function handleStripeFinance(request, response, { query, all, user, today, portal }) {
  const action = request.query?.action || '';
  if (action === 'finance-stripe-status') return response.json({ connected: stripeReady() });
  if (request.method !== 'POST') throw fail('Methode nicht erlaubt.', 405);
  if (!stripeReady()) throw fail('Stripe ist noch nicht vollständig verbunden. API-Schlüssel und Webhook-Signatur fehlen.', 503);
  const customerId = portal ? user.profile.id : request.body?.customerId;
  if (!uuid(customerId)) throw fail('Gültige Kunden-ID fehlt.');
  const profile = (await query(`user_profiles?id=eq.${customerId}&role=eq.user&select=id,name,email,source_lead_id`))[0];
  if (!profile) throw fail('Kunde nicht gefunden.', 404);
  if (!/^\S+@\S+\.\S+$/.test(profile.email || '')) throw fail('Im Kundenkonto fehlt eine gültige E-Mail-Adresse.', 409);
  const leads = await query(`leads?or=(converted_user_profile_id.eq.${customerId}${profile.source_lead_id ? `,and(id.eq.${profile.source_lead_id},converted_user_profile_id.is.null)` : ''})&select=id`);
  if (!leads.length) throw fail('Diesem Kunden ist keine Rechnung zugeordnet.', 409);
  const scope = `lead_id=in.(${leads.map(l => l.id).join(',')})`;
  const [invoices, payments, events] = await Promise.all([
    all(`finance_invoices?${scope}&status=eq.issued&select=*&order=id`),
    all(`lead_payments?${scope}&select=*&order=id`),
    all(`finance_account_events?${scope}&select=*&order=id`),
  ]);
  const account = customerAccount({ invoices, payments, events, today });
  const allocations = paymentAllocations(account, request.body?.invoiceId || '');
  const amountCents = allocations.reduce((sum, row) => sum + row.amountCents, 0);
  if (amountCents < 50 || amountCents > 99999999) throw fail('Der Zahlungsbetrag ist für Stripe nicht zulässig.', 409);
  const selected = request.body?.invoiceId || null;
  const prior = await query(`stripe_payment_sessions?customer_id=eq.${customerId}&status=eq.open&invoice_id=${selected ? `eq.${selected}` : 'is.null'}&amount_cents=eq.${amountCents}&expires_at=gt.${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}&select=*&order=created_at.desc&limit=5`);
  let sessionRow = prior.find(row => Array.isArray(row.allocations) && row.allocations.length === allocations.length && row.allocations.every((item, index) => item.invoiceId === allocations[index].invoiceId && Number(item.amountCents) === allocations[index].amountCents));
  if (!sessionRow) {
    const sessionId = crypto.randomUUID();
    const fields = {
      mode: 'payment', locale: 'de', client_reference_id: sessionId,
      customer_email: profile.email,
      success_url: `${appUrl()}/portal?stripe=return`,
      cancel_url: `${appUrl()}/portal?stripe=cancelled`,
      'metadata[session_id]': sessionId,
      'metadata[customer_id]': customerId,
      'payment_intent_data[metadata][session_id]': sessionId,
    };
    allocations.forEach((row, index) => {
      fields[`line_items[${index}][price_data][currency]`] = 'eur';
      fields[`line_items[${index}][price_data][unit_amount]`] = String(row.amountCents);
      fields[`line_items[${index}][price_data][product_data][name]`] = `Rechnung ${row.number}`;
      fields[`line_items[${index}][quantity]`] = '1';
    });
    const session = await stripeRequest('checkout/sessions', fields);
    if (!session.id || !session.url || session.currency !== 'eur' || session.amount_total !== amountCents)
      throw fail('Stripe hat die Zahlung nicht mit dem erwarteten Betrag bestätigt.', 502);
    const records = await query('stripe_payment_sessions', { method: 'POST', body: JSON.stringify({
      id: sessionId, customer_id: customerId, invoice_id: selected, allocations: allocations.map(({ invoiceId, amountCents }) => ({ invoiceId, amountCents })),
      amount_cents: amountCents, stripe_session_id: session.id, checkout_url: session.url,
      expires_at: new Date(session.expires_at * 1000).toISOString(), status: 'open',
    }) });
    sessionRow = records[0];
  }
  if (action === 'finance-stripe-send') {
    if (portal) throw fail('Nicht erlaubt.', 403);
    if (sessionRow.emailed_at) return response.json({ sent: true, alreadySent: true, expiresAt: sessionRow.expires_at });
    const amount = (amountCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    const subject = `Dein Zahlungslink · Finde dein Ding · ${amount}`;
    const body = `Hallo ${profile.name?.split(' ')[0] || ''},\n\nfür dein Kundenkonto ist ein Betrag von ${amount} offen. Über diesen sicheren Link kannst du die Zahlung mit den in Stripe verfügbaren Zahlungsarten abschließen:\n\n${sessionRow.checkout_url}\n\nDer Link ist bis ${new Date(sessionRow.expires_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr gültig. Deine Rechnungen und deinen aktuellen Zahlungsstand findest du auch unter „Konto und Finanzen“ im Kundenportal.\n\nWenn du bereits bezahlt hast, prüfe bitte zuerst den aktuellen Kontostand im Portal.`;
    if (!/^https:\/\/checkout\.stripe\.com\//.test(sessionRow.checkout_url)) throw fail('Stripe hat keinen gültigen Zahlungslink geliefert.', 502);
    const appearance = await mailAppearance({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
    const rendered = renderBrandedEmail({ subject, body, ...appearance });
    const escapedUrl = sessionRow.checkout_url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const html = rendered.html.replace(escapedUrl, `<a href="${escapedUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#ff995c;color:#17343b;font-weight:700;text-decoration:none">Jetzt sicher bezahlen ↗</a>`);
    const mail = await sendPreparedMail({ to: profile.email, subject, text: rendered.text, html });
    let logPending = false;
    try {
      await query(`stripe_payment_sessions?id=eq.${sessionRow.id}&emailed_at=is.null`, { method: 'PATCH', body: JSON.stringify({ emailed_at: new Date().toISOString() }) });
      await query('lead_communications', { method: 'POST', body: JSON.stringify({
      lead_id: leads[0].id, user_profile_id: customerId, direction: 'outbound', channel: 'email',
      subject, body: rendered.text, body_html: html, preview: `Stripe-Zahlungslink über ${amount} vom Mailserver angenommen.`,
      recipient_email: profile.email, sender_email: mail.senderEmail, provider_message_id: mail.providerMessageId,
      delivery_status: 'accepted', occurred_at: new Date().toISOString(),
      }) });
    } catch (error) { logPending = true; console.error('Stripe-Zahlungslink angenommen, CRM-Protokollierung prüfen', { sessionId: sessionRow.id, error: error.message }); }
    return response.json({ sent: true, logPending, expiresAt: sessionRow.expires_at });
  }
  return response.json({ url: sessionRow.checkout_url, expiresAt: sessionRow.expires_at });
}

export function verifyStripeSignature(rawBody, header, secret, now = Date.now()) {
  const parts = Object.fromEntries(String(header || '').split(',').map(part => part.trim().split('=')));
  const timestamp = Number(parts.t);
  if (!secret || !Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === 32 && crypto.timingSafeEqual(received, Buffer.from(expected, 'hex'));
}
