import { authHeaders, supabaseAuthConfig } from './user-auth.js';
import { verifyStripeSignature } from './stripe-finance.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return response.status(503).json({ error: 'Stripe-Webhook ist nicht konfiguriert.' });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) return response.status(413).json({ error: 'Ereignis zu groß.' });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!verifyStripeSignature(raw, request.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET))
    return response.status(400).json({ error: 'Ungültige Stripe-Signatur.' });
  let event;
  try { event = JSON.parse(raw); } catch { return response.status(400).json({ error: 'Ungültiges Ereignis.' }); }
  const session = event.data?.object;
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type))
    return response.json({ received: true });
  if (!session?.id || session.object !== 'checkout.session') return response.status(400).json({ error: 'Ungültige Checkout-Session.' });
  const service = supabaseAuthConfig();
  if (!service) return response.status(503).json({ error: 'Datenbank nicht verfügbar.' });
  const headers = authHeaders(service.serviceKey);
  try {
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const result = await fetch(`${service.url}/rest/v1/stripe_payment_sessions?stripe_session_id=eq.${encodeURIComponent(session.id)}&status=eq.open`, {
        method: 'PATCH', headers, body: JSON.stringify({ status: 'expired' }),
      });
      if (!result.ok) throw new Error('Ablaufstatus konnte nicht gespeichert werden.');
    } else if (session.payment_status === 'paid') {
      if (session.currency !== 'eur' || !Number.isSafeInteger(session.amount_total) || !session.payment_intent)
        return response.status(400).json({ error: 'Zahlungsdaten unvollständig.' });
      const result = await fetch(`${service.url}/rest/v1/rpc/finance_stripe_settle`, {
        method: 'POST', headers, body: JSON.stringify({ p_session: session.id, p_intent: session.payment_intent, p_amount_cents: session.amount_total }),
      });
      if (!result.ok) throw new Error('Bestätigte Stripe-Zahlung konnte nicht gebucht werden.');
    }
    return response.json({ received: true });
  } catch (error) {
    console.error('Stripe-Webhook konnte nicht gebucht werden', { eventId: event.id, type: event.type, sessionId: session.id, error: error.message });
    return response.status(500).json({ error: error.message });
  }
}
