(() => {
  let invoices = [], credits = [], plans = [], account = {}, stripeConnected = false, busy = false;
  const root = document.querySelector('#portalInvoiceList');
  const summary = document.querySelector('#portalFinanceSummary');
  const search = document.querySelector('#portalInvoiceSearch');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => Number(value || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const date = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('de-DE') : '—';
  const payButton = (invoiceId = '') => `<button type="button" class="portal-pay-button" data-stripe-pay="${invoiceId}" ${!stripeConnected || busy || account.customerCredit ? 'disabled' : ''}>Jetzt zahlen ↗</button>`;
  function render() {
    const open = Math.max(0, Number(account.balance || 0));
    summary.innerHTML = `<div class="portal-finance-balance"><div><small>Aktueller Kontostand</small><strong>${money(open)}</strong><span>${open ? 'Noch zu zahlen' : account.balance < 0 ? `Guthaben: ${money(-account.balance)}` : 'Konto ausgeglichen'}</span></div>${open ? payButton() : ''}</div><div class="portal-finance-facts"><span>Offene Rechnungen <b>${money(account.open)}</b></span><span>Aktuell fällig <b>${money(account.due)}</b></span><span>Bereits bezahlt <b>${money(account.payments)}</b></span></div>${account.customerCredit ? '<p class="portal-finance-note">Es gibt unverrechnete Zahlungen oder Guthaben. Bitte lass diese zuerst im Kundenkonto zuordnen.</p>' : ''}${!stripeConnected && open ? '<p class="portal-finance-note">Onlinezahlung wird eingerichtet. Deine Rechnungen bleiben weiterhin einsehbar.</p>' : ''}<p id="portalFinancePaymentStatus" role="status" aria-live="polite"></p>`;
    const q = search.value.trim().toLowerCase();
    const rows = invoices.filter(i => `${i.invoice_number} ${i.description}`.toLowerCase().includes(q));
    root.innerHTML = `<section class="portal-finance-section"><h2>Rechnungen <small>${rows.length}</small></h2>${rows.length ? `<div class="portal-invoice-rows">${rows.map(i => `<article class="portal-invoice-row"><div class="portal-invoice-primary"><strong>${escape(i.invoice_number)}</strong><span>${escape(i.description)}</span><small>Vom ${date(i.invoice_date)} · Fällig ${date(i.due_date)}</small></div><div class="portal-invoice-amount"><strong>${money(i.open)}</strong><small>${i.open > 0 ? 'offen' : 'bezahlt'} · Gesamt ${money(i.gross)}</small></div><div class="portal-invoice-actions"><a href="/api/leads?action=finance-my-pdf&id=${encodeURIComponent(i.id)}" target="_blank" rel="noopener">PDF ansehen ↗</a>${i.open > 0 && !i.installmentPlanId ? payButton(i.id) : ''}</div></article>`).join('')}</div>` : '<p class="empty">Keine Rechnungen gefunden.</p>'}</section>${plans.length ? `<section class="portal-finance-section"><h2>Ratenpläne</h2>${plans.map(p => `<article class="portal-plan-row"><strong>Vereinbarung vom ${date(p.agreed_on)}</strong><span>${money(p.open)} offen von ${money(p.total)}</span><div>${p.rates.map(r => `<span>Rate ${r.position}: ${money(r.amount)} · ${date(r.due_date)} · ${r.open ? `${money(r.open)} offen` : 'Bezahlt'}</span>`).join('')}</div></article>`).join('')}</section>` : ''}${credits.length ? `<section class="portal-finance-section"><h2>Gutschriften</h2>${credits.filter(e => `${e.document_number} ${e.reason}`.toLowerCase().includes(q)).map(e => `<article class="portal-credit-row"><strong>${escape(e.document_number)}</strong><span>${escape(e.reason)}</span><b>${money(e.amount)}</b><a href="/api/leads?action=finance-my-credit-pdf&id=${encodeURIComponent(e.id)}" target="_blank" rel="noopener">PDF ansehen ↗</a></article>`).join('')}</section>` : ''}`;
  }
  async function pay(invoiceId) {
    if (busy) return;
    busy = true; render();
    const status = summary.querySelector('#portalFinancePaymentStatus');
    status.textContent = 'Sichere Stripe-Zahlung wird vorbereitet …';
    try {
      const response = await fetch('/api/leads?action=finance-stripe-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoiceId ? { invoiceId } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Die Zahlung konnte nicht gestartet werden.');
      if (!/^https:\/\/checkout\.stripe\.com\//.test(data.url)) throw new Error('Ungültiger Stripe-Zahlungslink.');
      window.location.assign(data.url);
    } catch (error) { status.textContent = error.message; busy = false; render(); summary.querySelector('#portalFinancePaymentStatus').textContent = error.message; }
  }
  summary.addEventListener('click', event => { const button = event.target.closest('[data-stripe-pay]'); if (button) pay(button.dataset.stripePay); });
  root.addEventListener('click', event => { const button = event.target.closest('[data-stripe-pay]'); if (button) pay(button.dataset.stripePay); });
  search.addEventListener('input', render);
  window.loadPortalInvoices = async () => {
    root.textContent = 'Kontostand und Rechnungen werden geladen …';
    try {
      const [invoiceResponse, statusResponse] = await Promise.all([
        fetch('/api/leads?action=finance-my-invoices'),
        fetch('/api/leads?action=finance-stripe-status&portal=1'),
      ]);
      const data = await invoiceResponse.json();
      if (!invoiceResponse.ok) throw new Error(data.error || 'Finanzen konnten nicht geladen werden.');
      invoices = data.invoices || []; credits = data.credits || []; plans = data.plans || []; account = data.account || {};
      stripeConnected = statusResponse.ok && Boolean((await statusResponse.json()).connected);
      render();
      const flag = new URLSearchParams(location.search).get('stripe');
      if (flag === 'return') summary.querySelector('#portalFinancePaymentStatus').textContent = 'Stripe hat dich zurückgeleitet. Der Kontostand wird nach der bestätigten Zahlung aktualisiert.';
      if (flag === 'cancelled') summary.querySelector('#portalFinancePaymentStatus').textContent = 'Die Zahlung wurde nicht abgeschlossen.';
    } catch (error) { root.textContent = error.message; }
  };
})();
