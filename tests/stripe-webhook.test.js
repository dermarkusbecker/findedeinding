import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../lib/stripe-webhook.js';

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(body, secret = 'whsec_test') {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` }, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
}

test('signed, paid Checkout event books the payment through the database RPC', async t => {
  const saved = Object.fromEntries(['STRIPE_WEBHOOK_SECRET','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'].map(k => [k, process.env[k]]));
  Object.assign(process.env, { STRIPE_WEBHOOK_SECRET: 'whsec_test', SUPABASE_URL: 'https://database.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' });
  const original = global.fetch;
  t.after(() => { global.fetch = original; for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://database.test/rest/v1/rpc/finance_stripe_settle');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { p_session: 'cs_test_123', p_intent: 'pi_test_123', p_amount_cents: 7500 });
    return new Response(JSON.stringify({ booked: true }), { status: 200 });
  };
  const event = { id: 'evt_123', type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', object: 'checkout.session', currency: 'eur', amount_total: 7500, payment_status: 'paid', payment_intent: 'pi_test_123' } } };
  const ok = response();
  await handler(request(event), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(calls, 1);
  const unpaid = response();
  await handler(request({ ...event, data: { object: { ...event.data.object, payment_status: 'unpaid' } } }), unpaid);
  assert.equal(unpaid.statusCode, 200);
  assert.equal(calls, 1);
  const tampered = response();
  await handler(request(event, 'wrong_secret'), tampered);
  assert.equal(tampered.statusCode, 400);
  assert.equal(calls, 1);
});
