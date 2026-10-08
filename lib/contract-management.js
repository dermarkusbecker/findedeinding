const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const headers = service => ({ apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json' });

export async function expireContractCheckouts(service, contractId) {
  const invoiceResponse = await fetch(`${service.url}/rest/v1/finance_invoices?contract_id=eq.${encodeURIComponent(contractId)}&select=id`, { headers: headers(service) });
  if (!invoiceResponse.ok) throw new Error('Stripe-Zahlungslinks konnten nicht geprüft werden.');
  const invoiceIds = new Set((await invoiceResponse.json()).map(row => row.id));
  if (!invoiceIds.size) return { expired: 0 };
  const sessions = [];
  for (let offset = 0; ; offset += 500) {
    const sessionsResponse = await fetch(`${service.url}/rest/v1/stripe_payment_sessions?status=eq.open&select=id,stripe_session_id,allocations&order=created_at,id&limit=500&offset=${offset}`, { headers: headers(service) });
    if (!sessionsResponse.ok) throw new Error('Offene Stripe-Zahlungslinks konnten nicht geladen werden.');
    const page = await sessionsResponse.json();
    sessions.push(...page.filter(row => row.allocations?.some(item => invoiceIds.has(item.invoiceId))));
    if (page.length < 500) break;
  }
  let expired = 0;
  for (const row of sessions) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe-Zugang fehlt; offene Zahlungslinks bitte im Stripe-Dashboard beenden.');
    const result = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(row.stripe_session_id)}/expire`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw new Error('Ein bestehender Stripe-Zahlungslink konnte nicht beendet werden. Bitte im Stripe-Dashboard prüfen.');
    const saved = await fetch(`${service.url}/rest/v1/stripe_payment_sessions?id=eq.${encodeURIComponent(row.id)}&status=eq.open`, { method: 'PATCH', headers: headers(service), body: JSON.stringify({ status: 'expired' }) });
    if (!saved.ok) throw new Error('Stripe-Link wurde beendet, aber der CRM-Status konnte nicht gespeichert werden.');
    expired += 1;
  }
  return { expired };
}

export async function manageContract(service, { leadId, contractId, action, payload = {}, requestKey, actor }) {
  if (![leadId, contractId, requestKey].every(uuid)) throw fail('Gültige Akten-, Vertrags- und Anfrage-ID angeben.');
  if (!['edit', 'delete', 'sign', 'cancel', 'terminate', 'accelerate'].includes(action)) throw fail('Unbekannte Vertragsaktion.');
  const contractResponse = await fetch(`${service.url}/rest/v1/lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}&select=id,status,archived_at&limit=1`, { headers: headers(service) });
  if (!contractResponse.ok) throw fail('Vertrag konnte nicht geprüft werden.', 503);
  if (!(await contractResponse.json())[0]) throw fail('Vertrag wurde in dieser Akte nicht gefunden.', 404);
  const result = await fetch(`${service.url}/rest/v1/rpc/manage_lead_contract`, { method: 'POST', headers: headers(service), body: JSON.stringify({ p_contract: contractId, p_action: action, p_payload: payload, p_request: requestKey, p_actor: actor || 'CRM-Administrator' }) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw fail(data.message || 'Vertragsaktion konnte nicht gespeichert werden.', result.status >= 500 ? 503 : 400);
  return data;
}
