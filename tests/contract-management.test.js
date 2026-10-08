import test from 'node:test';
import assert from 'node:assert/strict';
import { manageContract, expireContractCheckouts } from '../lib/contract-management.js';
import { attachSignedContractPdf } from '../lib/contract-document.js';

const service = { url: 'https://db.example', key: 'service' };
const leadId = '00000000-0000-4000-8000-000000000001';
const contractId = '00000000-0000-4000-8000-000000000002';
const requestKey = '00000000-0000-4000-8000-000000000003';

test('contract action checks lead ownership before calling the protected RPC', async () => {
  const old = global.fetch;
  let calls = 0;
  global.fetch = async url => { calls++; assert.match(String(url), /lead_contracts\?id=eq\./); return Response.json([]); };
  try { await assert.rejects(manageContract(service, { leadId, contractId, action: 'cancel', requestKey, actor: 'Admin' }), error => error.status === 404); assert.equal(calls, 1); }
  finally { global.fetch = old; }
});

test('contract action sends reason and idempotency key to the transactional RPC', async () => {
  const old = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url: String(url), options }); return String(url).includes('lead_contracts?') ? Response.json([{ id: contractId }]) : Response.json({ contract_id: contractId, action: 'cancelled' }); };
  try {
    const result = await manageContract(service, { leadId, contractId, action: 'cancel', payload: { reason: 'Einvernehmliche Aufhebung' }, requestKey, actor: 'Admin' });
    assert.equal(result.action, 'cancelled');
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /rpc\/manage_lead_contract$/);
    assert.deepEqual(JSON.parse(calls[1].options.body), { p_contract: contractId, p_action: 'cancel', p_payload: { reason: 'Einvernehmliche Aufhebung' }, p_request: requestKey, p_actor: 'Admin' });
  } finally { global.fetch = old; }
});

test('cancellation expires only open Stripe sessions containing the cancelled invoice', async () => {
  const oldFetch = global.fetch, oldKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  const urls = [];
  global.fetch = async (url, options = {}) => {
    const path = String(url); urls.push(path);
    if (path.includes('finance_invoices?')) return Response.json([{ id: 'invoice-1' }]);
    if (path.includes('stripe_payment_sessions?')) return Response.json([{ id: 'session-1', stripe_session_id: 'cs_test_one', allocations: [{ invoiceId: 'invoice-1' }] }, { id: 'session-2', stripe_session_id: 'cs_test_other', allocations: [{ invoiceId: 'invoice-2' }] }]);
    if (path.includes('api.stripe.com')) { assert.equal(options.method, 'POST'); return Response.json({ status: 'expired' }); }
    if (path.includes('stripe_payment_sessions?id=')) { assert.match(options.body, /expired/); return Response.json([]); }
    throw new Error(path);
  };
  try { assert.deepEqual(await expireContractCheckouts(service, contractId), { expired: 1 }); assert.equal(urls.filter(url => url.includes('api.stripe.com')).length, 1); assert.ok(urls.some(url => url.includes('cs_test_one/expire'))); }
  finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = oldKey; }
});

test('a signed-contract upload rejects non-PDF content before accessing storage', async () => {
  await assert.rejects(attachSignedContractPdf(service, leadId, contractId, { fileName: 'fake.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('not a PDF').toString('base64') }), error => error.status === 400);
});
