(() => {
  const originalRenderLeadDashboard = renderLeadDashboard;
  renderLeadDashboard = function (data) {
    originalRenderLeadDashboard(data);
    document.querySelectorAll('#leadContractList article').forEach((card, index) => {
      const contract = data.contracts[index];
      if (!contract) return;
      if (contract.archived_at) { card.remove(); return; }
      card.insertAdjacentHTML('beforeend', `<button type="button" class="secondary" data-manage-contract="${escapeHtml(contract.id)}" data-manage-lead="${escapeHtml(contract.lead_id)}">Vertrag öffnen →</button>`);
      if (contract.terminated_effective_on) card.insertAdjacentHTML('beforeend', `<small>Gekündigt zum ${crmDate(contract.terminated_effective_on)}</small>`);
      if (contract.accelerated_at) card.insertAdjacentHTML('beforeend', '<small>Restbetrag fällig gestellt</small>');
      if (contract.archived_at) card.insertAdjacentHTML('beforeend', '<small>Archiviert</small>');
    });
  };
  const originalOpenLeadRecord = openLeadRecord;
  openLeadRecord = async function (type) {
    await originalOpenLeadRecord(type);
    if (type === 'contract') {
      const status = document.querySelector('#leadRecordForm [name="status"]');
      status?.querySelector('[value="signed"]')?.remove();
      status?.querySelector('[value="cancelled"]')?.remove();
      document.querySelector('#leadRecordCopy').textContent = 'Entwurf mit Tarifkonditionen anlegen. Den unterschriebenen Vertrag anschließend mit dem Original-PDF im Vertragsfenster abschließen.';
    }
  };

  const dialog = document.createElement('dialog');
  dialog.id = 'crmContractManager';
  dialog.className = 'crm-task-editor customer-contract-dialog';
  dialog.innerHTML = '<div class="dialog-head"><div><p class="eyebrow">Vertragsverwaltung</p><h2 id="crmContractManagerTitle">Vertrag</h2></div><button type="button" data-contract-close aria-label="Schließen">×</button></div><div id="crmContractManagerContent"></div><p id="crmContractManagerStatus" role="status"></p>';
  document.body.append(dialog);
  const style = document.createElement('style');
  style.textContent = '#crmContractManager{width:min(680px,calc(100vw - 28px));max-height:90vh;overflow:auto;padding:24px}#crmContractManagerContent{display:grid;gap:14px}#crmContractManagerContent .contract-actions{display:flex;flex-wrap:wrap;gap:8px}#crmContractManagerContent .contract-actions button{width:auto}#crmContractManagerContent label{display:grid;gap:6px}#crmContractManagerContent input,#crmContractManagerContent select,#crmContractManagerContent textarea{width:100%}#crmContractManagerContent .contract-note{background:#edf5f4;padding:12px;border-radius:10px}#leadContractList article>button[data-manage-contract]{margin-top:8px}';
  document.head.append(style);
  let current = null;
  let source = 'lead';
  let busy = false;
  const date = value => value ? String(value).slice(0, 10) : '';
  const readPdf = async file => {
    if (!file || file.type !== 'application/pdf' || file.size > 3 * 1024 * 1024) throw new Error('Bitte das unterschriebene Vertrags-PDF bis 3 MB auswählen.');
    const contentBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('PDF konnte nicht gelesen werden.')); reader.readAsDataURL(file); });
    return { fileName: file.name, mimeType: 'application/pdf', contentBase64 };
  };
  const allContracts = () => source === 'customer' ? (window.crmContracts || []) : (activeLeadDashboard?.contracts || []);
  const selectedTariffs = () => (typeof serviceTariffs !== 'undefined' ? serviceTariffs : []).filter(item => item.is_active);

  function details() {
    const c = current;
    const editable = ['draft', 'sent'].includes(c.status) && !c.archived_at;
    const live = c.status === 'signed' && !c.archived_at;
    document.querySelector('#crmContractManagerTitle').textContent = c.contract_number || c.title || 'Vertrag';
    const pdf = c.document_storage_path ? `<a href="/api/leads?action=contract-download&id=${encodeURIComponent(c.lead_id)}&contractId=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Vertrags-PDF öffnen ↗</a>` : 'Noch kein Vertrags-PDF hinterlegt';
    document.querySelector('#crmContractManagerContent').innerHTML = `<p><strong>${escapeHtml(c.title)}</strong> · ${euro(c.amount)}<br>${escapeHtml(contractStatusLabels[c.status] || c.status)}${c.terminated_effective_on ? ` · Kündigung zum ${crmDate(c.terminated_effective_on)}` : ''}${c.accelerated_at ? ' · Rest fällig gestellt' : ''}${c.archived_at ? ' · Archiviert' : ''}</p><p>${pdf}${c.invoice?.number ? ` · Rechnung ${escapeHtml(c.invoice.number)}` : ''}</p><p class="contract-note">Tarif: ${escapeHtml(c.contract_data?.tariffName || c.title)} · Laufzeit: ${escapeHtml(c.contract_data?.duration || 'nicht hinterlegt')} · Zahlungsmodell: ${escapeHtml(c.contract_data?.paymentModel || 'nicht hinterlegt')}</p>${editable ? `<div class="contract-actions"><button type="button" class="secondary" data-contract-action="edit">Entwurf bearbeiten</button><button type="button" class="primary" data-contract-action="sign">Als unterschrieben erfassen</button><button type="button" class="secondary" data-contract-action="delete">Entwurf löschen</button></div>` : ''}${live ? `<div class="contract-actions"><button type="button" class="secondary" data-contract-action="send">Vertrag & Rechnung per E-Mail prüfen/senden</button><button type="button" class="secondary" data-contract-action="cancel">Stornieren</button><button type="button" class="secondary" data-contract-action="terminate">Kündigen</button><button type="button" class="secondary" data-contract-action="accelerate">Rest fällig stellen</button><button type="button" class="secondary" data-contract-action="delete">Archivieren</button></div>` : ''}`;
    document.querySelector('#crmContractManagerStatus').textContent = '';
  }

  async function refresh() {
    const leadId = current.lead_id;
    dialog.close();
    if (source === 'customer' && activeCustomerDashboard?.person?.id) await openCustomerDashboard(activeCustomerDashboard.person.id, 'contracts');
    else await openLeadDashboard(leadId, leadDashboardPage);
  }

  async function submit(action, payload, signedDocument = null) {
    if (busy) return;
    busy = true;
    const status = document.querySelector('#crmContractManagerStatus');
    status.textContent = 'Vertragsaktion wird gespeichert …';
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/leads?action=contract-manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.lead_id, contractId: current.id, contractAction: action, payload, signedDocument, requestKey: crypto.randomUUID() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Vertragsaktion fehlgeschlagen.');
      await refresh();
      toast(action === 'sign' ? `Vertrag abgeschlossen.${data.mailStatus?.error ? ` E-Mail-Versand offen: ${data.mailStatus.error}` : data.mailStatus?.invoice === 'accepted' ? ' Vertrag und Rechnung wurden von STRATO angenommen.' : ' E-Mail-Status im Kommunikationsverlauf prüfen.'}` : action === 'cancel' ? `Vertrag storniert und Gutschrift gebucht.${data.stripeStatus?.error ? ` Stripe-Link prüfen: ${data.stripeStatus.error}` : ''}` : action === 'terminate' ? 'Kündigung mit Datum gespeichert. Zahlungsfälligkeit bleibt bestehen.' : action === 'accelerate' ? 'Offene Beträge fällig gestellt.' : 'Vertrag aktualisiert.');
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }

  document.addEventListener('click', async event => {
    const opener = event.target.closest('[data-manage-contract]');
    if (opener) {
      source = opener.closest('#leadContractList') ? 'lead' : 'customer';
      current = allContracts().find(item => item.id === opener.dataset.manageContract && item.lead_id === opener.dataset.manageLead);
      if (!current) return toast('Vertrag konnte nicht geladen werden.');
      details(); dialog.showModal(); return;
    }
    if (event.target.closest('[data-contract-close]')) { dialog.close(); return; }
    const button = event.target.closest('[data-contract-action]');
    if (!button || !dialog.open || !current || busy) return;
    const action = button.dataset.contractAction;
    if (action === 'send') {
      if (busy) return;
      busy = true; document.querySelector('#crmContractManagerStatus').textContent = 'E-Mail-Status wird geprüft …';
      try { const result = await fetch('/api/leads?action=contract-send-documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.lead_id, contractId: current.id }) }); const data = await result.json(); if (!result.ok) throw new Error(data.error || 'Versand fehlgeschlagen.'); document.querySelector('#crmContractManagerStatus').textContent = data.mailStatus?.invoice === 'accepted' ? 'Vertrag und Rechnung wurden von STRATO angenommen.' : data.mailStatus?.invoice === 'already_accepted' ? 'Vertrag und Rechnung wurden bereits versendet.' : 'Versandstatus unklar. Bitte Kommunikationsverlauf und STRATO-Postfach prüfen.'; } catch (error) { document.querySelector('#crmContractManagerStatus').textContent = error.message; } finally { busy = false; }
      return;
    }
    if (action === 'edit') {
      try { await loadServiceTariffs(); } catch (error) { return toast(error.message); }
      const tariffs = selectedTariffs();
      document.querySelector('#crmContractManagerContent').innerHTML = `<form id="crmContractEditForm"><label>Tarif<select name="tariffId" required>${tariffs.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === current.tariff_id ? 'selected' : ''}>${escapeHtml(t.name)} · ${euro(t.gross_price)}</option>`).join('')}</select></label><label>Leistungsbeginn<input type="date" name="effectiveOn" value="${escapeHtml(date(current.program_start_date))}" required></label><div class="contract-actions"><button class="primary" type="submit">Entwurf speichern</button><button class="secondary" type="button" data-contract-back>Zurück</button></div></form>`;
      return;
    }
    if (action === 'sign') {
      document.querySelector('#crmContractManagerContent').innerHTML = '<form id="crmContractSignForm"><p class="contract-note">Das Original des unterschriebenen Vertrags wird in der Akte abgelegt. Erst danach werden Vertragsdokument und Rechnung per STRATO verschickt.</p><label>Unterschriebenes Vertrags-PDF<input type="file" name="signedPdf" accept="application/pdf,.pdf" required></label><label><input type="checkbox" name="confirmed" required> Verbindlichen Abschluss und Echtheit des Dokuments bestätigt</label><div class="contract-actions"><button type="submit" class="primary">Vertrag abschließen</button><button type="button" class="secondary" data-contract-back>Zurück</button></div></form>';
      return;
    }
    if (action === 'delete') {
      const reason = window.prompt(current.status === 'signed' ? 'Archivierungsgrund:' : 'Grund für das Löschen des Entwurfs:');
      if (reason !== null) await submit('delete', { reason });
      return;
    }
    const fields = action === 'terminate' ? '<label>Wirksam zum<input name="effectiveOn" type="date" required></label>' : '';
    const basis = action === 'accelerate' ? '<label><input name="basisConfirmed" type="checkbox" required> Vertragliche oder gesetzliche Grundlage geprüft und bestätigt</label>' : '';
    const info = action === 'cancel' ? 'Stornierung hebt die Forderung auf; eine ausgestellte Rechnung wird durch eine Gutschrift korrigiert.' : action === 'terminate' ? 'Die Kündigung ändert die Zahlungsfälligkeit nicht.' : 'Alle noch offenen Rechnungsbeträge werden sofort fällig.';
    document.querySelector('#crmContractManagerContent').innerHTML = `<form id="crmContractActionForm" data-action="${action}"><p class="contract-note">${info}</p>${fields}<label>Begründung<textarea name="reason" minlength="3" maxlength="900" required></textarea></label>${basis}<div class="contract-actions"><button type="submit" class="primary">${action === 'cancel' ? 'Stornierung buchen' : action === 'terminate' ? 'Kündigung speichern' : 'Rest fällig stellen'}</button><button type="button" class="secondary" data-contract-back>Zurück</button></div></form>`;
  });
  dialog.addEventListener('click', event => { if (event.target.closest('[data-contract-back]')) details(); });
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    if (form.id === 'crmContractEditForm') return submit('edit', Object.fromEntries(new FormData(form)));
    if (form.id === 'crmContractSignForm') { try { return await submit('sign', {}, await readPdf(form.elements.signedPdf.files[0])); } catch (error) { document.querySelector('#crmContractManagerStatus').textContent = error.message; return; } }
    if (form.id === 'crmContractActionForm') return submit(form.dataset.action, { ...Object.fromEntries(new FormData(form)), basisConfirmed: form.elements.basisConfirmed?.checked === true });
  });
})();
