import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { paymentAllocations, stripeRequest, verifyStripeSignature } from '../lib/stripe-finance.js';

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
