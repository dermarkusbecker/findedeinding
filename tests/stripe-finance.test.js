import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { handleStripeFinance, paymentAllocations, stripeRequest, verifyStripeSignature } from '../lib/stripe-finance.js';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const account = {
  summary: { balance: 75, customerCredit: 0 },
  invoices: [
    { id: second, invoice_number: 'RE-2', description: 'Zweite Rechnung', open: 25, due_date: '2026-10-02' },
    { id: first, invoice_number: 'RE-1', description: 'Erste Rechnung', open: 50, due_date: '2026-10-01' },
  ],
};

test('Stripe receives only positive open amounts in invoice due order', () => {
  assert.deepEqual(paymentAllocations(account).map(row => [row.invoiceId, row.amountCents]), [[first, 5000], [second, 2500]]);
  assert.deepEqual(paymentAllocations(account, second).map(row => row.amountCents), [2500]);
  assert.throws(() => paymentAllocations({ ...account, summary: { balance: 50, customerCredit: 25 } }), /zuerst im CRM zuordnen/);
  assert.throws(() => paymentAllocations(account, crypto.randomUUID()), /Keine offene Rechnung/);
});

test('Stripe API request uses server secret and hosted Checkout form fields', async t => {
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_only_for_unit_test';
  t.after(() => { if (before === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before; });
  const result = await stripeRequest('checkout/sessions', { mode: 'payment', 'line_items[0][price_data][unit_amount]': '5000' }, async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_only_for_unit_test');
    assert.equal(options.body.get('line_items[0][price_data][unit_amount]'), '5000');
    assert.equal(options.body.get('payment_method_types[0]'), null);
    return new Response(JSON.stringify({ id: 'cs_test_1', amount_total: 5000 }), { status: 200 });
  });
  assert.equal(result.id, 'cs_test_1');
});

test('Stripe webhook signature rejects tampered and old events', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const timestamp = 1780246800;
  const signature = crypto.createHmac('sha256', 'whsec_test').update(`${timestamp}.${body}`).digest('hex');
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(verifyStripeSignature(body, header, 'whsec_test', timestamp * 1000), true);
  assert.equal(verifyStripeSignature(body + ' ', header, 'whsec_test', timestamp * 1000), false);
  assert.equal(verifyStripeSignature(body, header, 'whsec_test', (timestamp + 301) * 1000), false);
});


test('portal Checkout derives its EUR amount from this customer ledger, not the browser body', async t => {
  const before = { key: process.env.STRIPE_SECRET_KEY, webhook: process.env.STRIPE_WEBHOOK_SECRET };
  process.env.STRIPE_SECRET_KEY = 'sk_live_only_for_unit_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_only_for_unit_test';
  const oldFetch = global.fetch;
  t.after(() => {
    global.fetch = oldFetch;
    if (before.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before.key;
    if (before.webhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = before.webhook;
  });
  const customerId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const invoice = { id: first, lead_id: leadId, status: 'issued', invoice_date: '2026-09-01', due_date: '2026-09-10', invoice_number: 'RE-1', description: 'Coaching', gross: 75, net: 63.03, vat: 11.97, created_at: '2026-09-01T00:00:00Z' };
  let stored;
  const query = async (path, options = {}) => {
    if (path.startsWith('user_profiles?')) return [{ id: customerId, name: 'Kunde Test', email: 'kunde@example.test' }];
    if (path.startsWith('leads?')) { assert.match(path, new RegExp(customerId)); return [{ id: leadId }]; }
    if (path.startsWith('stripe_payment_sessions?')) return [];
    if (path === 'stripe_payment_sessions' && options.method === 'POST') { stored = JSON.parse(options.body); return [stored]; }
    throw new Error(`Unexpected query ${path}`);
  };
  const all = async path => {
    if (path.startsWith('finance_invoices?')) return [invoice];
    if (path.startsWith('lead_payments?') || path.startsWith('finance_account_events?')) return [];
    throw new Error(`Unexpected list ${path}`);
  };
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.body.get('line_items[0][price_data][unit_amount]'), '7500');
    assert.equal(options.body.get('payment_method_types[0]'), null);
    return Response.json({ id: 'cs_test_scoped', url: 'https://checkout.stripe.com/c/pay/test', currency: 'eur', amount_total: 7500, expires_at: Math.floor(Date.now() / 1000) + 3600 });
  };
  const response = { json(value) { this.body = value; return this; } };
  await handleStripeFinance({ method: 'POST', query: { action: 'finance-stripe-checkout' }, body: { amount: 1, customerId: crypto.randomUUID() } }, response, { query, all, user: { profile: { id: customerId } }, today: '2026-09-30', portal: true });
  assert.equal(stored.customer_id, customerId);
  assert.equal(stored.amount_cents, 7500);
  assert.deepEqual(stored.allocations, [{ invoiceId: first, amountCents: 7500 }]);
  assert.equal(response.body.url, 'https://checkout.stripe.com/c/pay/test');
});
