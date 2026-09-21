(() => {
 const dialog=document.querySelector('#customerContractDialog'),form=document.querySelector('#customerContractForm'),status=document.querySelector('#customerContractSaveStatus');
 let tariffs=[],customerId='',requestKey='',saving=false;
 const canCreate=()=>activeStaffPermissions.includes('customers');
 window.renderCustomerContracts=data=>{
  const contracts=(data.customer?.contracts||[]).filter(c=>c.status==='signed');
  document.querySelector('#customerActiveContractCount').textContent=String(contracts.length);
  document.querySelector('#newCustomerContract').hidden=!canCreate();
  document.querySelector('#customerActiveContracts').innerHTML=contracts.length?contracts.map(c=>`<article><div><strong>${escapeHtml(c.title)}</strong><b>${euro(c.amount)}</b></div><small>${escapeHtml(c.contract_number||'Vertrag')} · Beginn ${c.program_start_date?crmDate(c.program_start_date):'offen'}${c.contract_data?.duration?` · ${escapeHtml(c.contract_data.duration)}`:''}</small><nav>${c.document_storage_path?`<a href="/api/leads?action=contract-download&id=${encodeURIComponent(c.lead_id)}&contractId=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Vertragsdokument ↗</a>`:''}${c.invoice?.status==='issued'&&activeStaffPermissions.includes('finance')?`<a href="/api/leads?action=finance-pdf&id=${encodeURIComponent(c.invoice.id)}" target="_blank" rel="noopener">${escapeHtml(c.invoice.number)} ↗</a>`:`<span>${c.invoice?.status==='needs_details'?'Rechnung: Angaben fehlen':c.invoice?.status==='issued'?'Rechnung erstellt':'Noch keine Rechnung'}</span>`}</nav></article>`).join(''):'<p class="empty">Noch keine aktiven Verträge hinterlegt.</p>';
  if(data.customer?.finance?.pendingInvoices)document.querySelector('#customerBalanceState').textContent+=` · ${data.customer.finance.pendingInvoices} Rechnung(en) benötigen Angaben`;
 };
 const tariffInfo=()=>{const t=tariffs.find(item=>item.id===form.elements.tariffId.value);document.querySelector('#customerContractTariffInfo').innerHTML=t?`<strong>${escapeHtml(t.product_label)}</strong><p>${escapeHtml(t.duration_label)} · ${escapeHtml(t.payment_model)}</p><b>${euro(t.gross_price)} brutto</b>`:'';};
 document.querySelector('#newCustomerContract').addEventListener('click',async()=>{
  if(!canCreate()||!activeCustomerDashboard)return;
  customerId=activeCustomerDashboard.person.id;requestKey=crypto.randomUUID();form.reset();status.textContent='Tarife werden geladen …';document.querySelector('#customerContractFor').textContent=activeCustomerDashboard.customer?.profile?.name||activeCustomerDashboard.person.name;form.elements.serviceStart.value=browserDateKey();form.querySelector('[type=submit]').disabled=true;form.elements.tariffId.innerHTML='';document.querySelector('#customerContractTariffInfo').innerHTML='';dialog.showModal();
  try{const result=await fetch(`/api/customer-records?action=customer-contracts&participantId=${encodeURIComponent(customerId)}`),data=await result.json();if(!result.ok)throw new Error(data.error);tariffs=data.tariffs||[];form.elements.tariffId.innerHTML=tariffs.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');tariffInfo();status.textContent=tariffs.length?'':'Bitte zuerst unter Einstellungen → Tarife einen aktiven Tarif anlegen.';form.querySelector('[type=submit]').disabled=!tariffs.length;}catch(error){status.textContent=error.message;}
 });
 form.elements.tariffId.addEventListener('change',tariffInfo);
 form.querySelectorAll('[data-close-customer-contract]').forEach(b=>b.addEventListener('click',()=>{if(!saving)dialog.close();}));
 dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(saving)return;const tariff=tariffs.find(t=>t.id===form.elements.tariffId.value);if(!tariff)return;
  saving=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Vertrag und Rechnung werden gespeichert …';
  try{const result=await fetch('/api/customer-records?action=customer-contracts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participantId:customerId,requestKey,tariffId:tariff.id,serviceStart:form.elements.serviceStart.value,expectedGross:Number(tariff.gross_price),confirmed:form.elements.confirmed.checked})}),data=await result.json();if(!result.ok)throw new Error(data.error||'Vertrag konnte nicht gespeichert werden.');dialog.close();await openCustomerDashboard(customerId,'dashboard');toast(`Vertrag und Rechnung ${data.invoice_number} erstellt.${data.archivePending?' Der PDF-Beleg wird beim Öffnen erneut archiviert.':''}`);}catch(error){status.textContent=error.message;}finally{saving=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 });
})();
