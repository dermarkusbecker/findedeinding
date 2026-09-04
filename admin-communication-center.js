let communicationTemplates=[];
let communicationCampaigns=[];
let communicationAutomations=[];
let communicationCenterContacts=[];
let communicationCenterLoaded=false;
let activeCommunicationTemplateId=null;
let campaignSelectedContacts=new Set();

const templateCategoryLabels={general:'Allgemein',lead:'Interessenten',appointment:'Termine',contract:'Vertrag',participant:'Teilnehmer',program:'8-Wochen-Prozess'};
const triggerLabels={lead_created:'Interessent neu angelegt',appointment_scheduled:'Termin vereinbart',contract_signed:'Vertrag abgeschlossen',participant_activated:'Teilnehmer aktiviert',week_unlocked:'Programmwoche freigeschaltet',inactivity:'Keine Aktivität'};
const audienceLabels={all:'Alle Kontakte',leads:'Interessenten',customers:'Teilnehmer',selected:'Ausgewählte Kontakte',event_contact:'Betroffener Kontakt'};
const campaignStatusLabels={draft:'Entwurf',scheduled:'Geplant',paused:'Pausiert',completed:'Abgeschlossen',cancelled:'Abgebrochen'};
const delayUnitLabels={minutes:'Min.',hours:'Std.',days:'Tage'};

function setCommunicationSection(section='mailbox',mailbox=''){
  document.querySelectorAll('[data-communication-section]').forEach(panel=>panel.classList.toggle('active',panel.dataset.communicationSection===section));
  if(section==='mailbox'&&mailbox)setCommunicationFolder(mailbox);
  if(section!=='mailbox')loadCommunicationCenter();
  window.scrollTo({top:0,behavior:'smooth'});
}

function communicationPlaceholderList(value=''){
  return [...new Set(String(value).match(/{{[a-z_]+}}/gi)||[])];
}

function renderTemplatePreview(){
  const pane=document.querySelector('#communicationTemplatePreview');
  const item=communicationTemplates.find(template=>template.id===activeCommunicationTemplateId);
  if(!item){pane.innerHTML='<div class="template-preview-empty"><span>▧</span><h3>Vorlage auswählen</h3><p>Wähle links eine Vorlage aus, um Inhalt, Platzhalter und Freigabestatus zu prüfen.</p></div>';return;}
  const placeholders=communicationPlaceholderList(`${item.subject} ${item.body}`);
  pane.innerHTML=`<div class="template-preview-head"><div><div class="template-tags"><span class="communication-badge ${escapeHtml(item.status)}">${item.status==='active'?'Freigegeben':'Entwurf'}</span><span class="communication-badge">${escapeHtml(item.channel==='email'?'E-Mail':'WhatsApp')}</span><span class="communication-badge">${escapeHtml(templateCategoryLabels[item.category]||item.category)}</span></div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description||'Keine Kurzbeschreibung hinterlegt.')}</p></div><button type="button" class="secondary" data-edit-template="${escapeHtml(item.id)}">Bearbeiten ···</button></div><div class="template-mail-preview"><small>Live-Vorschau · Betreff</small><h4>${escapeHtml(item.subject)}</h4><div class="template-mail-body">${escapeHtml(item.body)}</div></div><div class="template-placeholders"><small>Verwendete Platzhalter</small>${placeholders.length?placeholders.map(value=>`<code>${escapeHtml(value)}</code>`).join(''):'<span class="communication-badge">Keine</span>'}</div>`;
  pane.querySelector('[data-edit-template]')?.addEventListener('click',()=>openTemplateDialog(item.id));
}

function renderTemplates(){
  const query=(document.querySelector('#templateSearch')?.value||'').trim().toLowerCase();
  const category=document.querySelector('#templateCategory')?.value||'';
  const filtered=communicationTemplates.filter(item=>(!category||item.category===category)&&(!query||`${item.name} ${item.subject} ${item.description||''} ${item.body}`.toLowerCase().includes(query)));
  if(activeCommunicationTemplateId&&!filtered.some(item=>item.id===activeCommunicationTemplateId))activeCommunicationTemplateId=null;
  if(!activeCommunicationTemplateId&&filtered.length)activeCommunicationTemplateId=filtered[0].id;
  document.querySelector('#templateResultCount').textContent=`${filtered.length} ${filtered.length===1?'Vorlage':'Vorlagen'}`;
  document.querySelector('#templateTotal').textContent=String(communicationTemplates.length);
  document.querySelector('#templateActive').textContent=String(communicationTemplates.filter(item=>item.status==='active').length);
  document.querySelector('#templateDraft').textContent=String(communicationTemplates.filter(item=>item.status==='draft').length);
  document.querySelector('#templateChannels').textContent=String(new Set(communicationTemplates.map(item=>item.channel)).size||1);
  const list=document.querySelector('#communicationTemplateList');
  list.innerHTML=filtered.length?filtered.map(item=>`<button type="button" class="template-list-item ${item.id===activeCommunicationTemplateId?'active':''}" data-template-id="${escapeHtml(item.id)}"><div><h3>${escapeHtml(item.name)}</h3><span class="communication-badge ${escapeHtml(item.status)}">${item.status==='active'?'Freigegeben':'Entwurf'}</span></div><p>${escapeHtml(item.description||item.subject)}</p><div class="template-tags"><span class="communication-badge">${escapeHtml(templateCategoryLabels[item.category]||item.category)}</span><span class="communication-badge">${escapeHtml(item.channel==='email'?'✉ E-Mail':'WhatsApp')}</span></div></button>`).join(''):'<div class="empty">Keine Vorlagen für diesen Filter gefunden.</div>';
  list.querySelectorAll('[data-template-id]').forEach(button=>button.addEventListener('click',()=>{activeCommunicationTemplateId=button.dataset.templateId;renderTemplates();}));
  renderTemplatePreview();
}

function fillTemplateSelects(){
  const options='<option value="">Ohne Vorlage</option>'+communicationTemplates.filter(item=>item.status!=='archived').map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${item.status==='active'?'freigegeben':'Entwurf'}</option>`).join('');
  ['communicationComposerTemplate','campaignTemplate'].forEach(id=>{const select=document.querySelector(`#${id}`);if(!select)return;const current=select.value;select.innerHTML=options;if(communicationTemplates.some(item=>item.id===current))select.value=current;});
  const automation=document.querySelector('#automationTemplate');
  if(automation){const current=automation.value;automation.innerHTML='<option value="">Vorlage auswählen</option>'+communicationTemplates.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');if(communicationTemplates.some(item=>item.id===current))automation.value=current;}
}

function campaignDate(value){
  if(!value)return'Noch offen';
  const date=new Date(value);return Number.isNaN(date.getTime())?'Noch offen':date.toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'});
}

function renderCampaigns(){
  const query=(document.querySelector('#campaignSearch')?.value||'').trim().toLowerCase();
  const filtered=communicationCampaigns.filter(item=>!query||`${item.name} ${item.subject}`.toLowerCase().includes(query));
  document.querySelector('#campaignScheduled').textContent=String(communicationCampaigns.filter(item=>item.status==='scheduled').length);
  const list=document.querySelector('#communicationCampaignList');
  list.innerHTML=filtered.length?filtered.map(item=>`<article class="campaign-row"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.subject)}</p></div><dl><dt>Zielgruppe</dt><dd>${escapeHtml(audienceLabels[item.audience_type]||item.audience_type)}</dd></dl><dl><dt>Empfänger</dt><dd>${Number(item.recipient_count||0)}</dd></dl><dl><dt>Versandzeit</dt><dd>${escapeHtml(campaignDate(item.scheduled_at))}</dd></dl><div class="campaign-actions"><span class="communication-badge ${escapeHtml(item.status)}">${escapeHtml(campaignStatusLabels[item.status]||item.status)}</span><button type="button" class="secondary" data-edit-campaign="${escapeHtml(item.id)}">Bearbeiten ···</button>${['scheduled','paused'].includes(item.status)?`<button type="button" class="secondary" data-toggle-campaign="${escapeHtml(item.id)}" data-campaign-status="${item.status==='scheduled'?'paused':'scheduled'}">${item.status==='scheduled'?'Pausieren':'Aktivieren'}</button>`:''}</div></article>`).join(''):'<div class="empty">Noch keine Seriennachrichten angelegt.</div>';
  list.querySelectorAll('[data-edit-campaign]').forEach(button=>button.addEventListener('click',()=>openCampaignDialog(button.dataset.editCampaign)));
  list.querySelectorAll('[data-toggle-campaign]').forEach(button=>button.addEventListener('click',()=>setCampaignState(button.dataset.toggleCampaign,button.dataset.campaignStatus)));
}

function automationDelay(item){
  if(!Number(item.delay_value))return'Sofort';
  return`${Number(item.delay_value)} ${delayUnitLabels[item.delay_unit]||item.delay_unit}`;
}

function renderAutomations(){
  document.querySelector('#automationActiveCount').textContent=`${communicationAutomations.filter(item=>item.enabled).length} aktiv`;
  const list=document.querySelector('#communicationAutomationList');
  list.innerHTML=communicationAutomations.length?communicationAutomations.map(item=>{const template=communicationTemplates.find(entry=>entry.id===item.template_id);return`<article class="automation-card"><div class="automation-card-head"><span class="automation-card-icon">⚡</span><div class="automation-card-title"><h3>${escapeHtml(item.name)}</h3><small>${item.enabled?'Regel aktiv · Versand wartet auf Mail-Schnittstelle':'Regel deaktiviert'}</small></div><span class="communication-badge ${item.enabled?'active':'paused'}">${item.enabled?'Aktiv':'Inaktiv'}</span></div><div class="automation-card-flow"><div><small>Auslöser</small><b>${escapeHtml(triggerLabels[item.trigger_type]||item.trigger_type)}</b></div><span>→</span><div><small>Wartezeit</small><b>${escapeHtml(automationDelay(item))}</b></div><span>→</span><div><small>Vorlage</small><b>${escapeHtml(template?.name||'Nicht gefunden')}</b></div></div><div class="automation-card-foot"><span class="communication-badge">${escapeHtml(audienceLabels[item.audience_type]||item.audience_type)}</span><div><button type="button" class="secondary" data-edit-automation="${escapeHtml(item.id)}">Bearbeiten ···</button><button type="button" class="secondary" data-toggle-automation="${escapeHtml(item.id)}" data-enabled="${item.enabled?'false':'true'}">${item.enabled?'Deaktivieren':'Aktivieren'}</button></div></div></article>`;}).join(''):'<div class="empty">Noch keine automatisierten Nachrichten angelegt.</div>';
  list.querySelectorAll('[data-edit-automation]').forEach(button=>button.addEventListener('click',()=>openAutomationDialog(button.dataset.editAutomation)));
  list.querySelectorAll('[data-toggle-automation]').forEach(button=>button.addEventListener('click',()=>setAutomationState(button.dataset.toggleAutomation,button.dataset.enabled==='true')));
}

function updateAudienceSummary(){
  const all=communicationCenterContacts.length,leads=communicationCenterContacts.filter(item=>item.type==='lead').length,customers=all-leads;
  document.querySelector('#audienceAll').textContent=String(all);
  document.querySelector('#audienceLeads').textContent=String(leads);
  document.querySelector('#audienceCustomers').textContent=String(customers);
}

async function loadCommunicationCenter(force=false){
  if(communicationCenterLoaded&&!force){renderTemplates();renderCampaigns();renderAutomations();return;}
  try{
    const response=await fetch('/api/communications?action=center'),data=await response.json();
    if(!response.ok)throw new Error(data.error);
    communicationTemplates=data.templates||[];communicationCampaigns=data.campaigns||[];communicationAutomations=data.automations||[];communicationCenterContacts=data.contacts||[];communicationCenterLoaded=true;
    if(data.contacts?.length)communicationContacts=data.contacts;
    fillTemplateSelects();updateAudienceSummary();renderTemplates();renderCampaigns();renderAutomations();renderCommunicationRecipients();
  }catch(error){
    ['communicationTemplateList','communicationCampaignList','communicationAutomationList'].forEach(id=>{const element=document.querySelector(`#${id}`);if(element)element.innerHTML=`<div class="empty system-error">${escapeHtml(error.message||'Kommunikations-Center konnte nicht geladen werden.')}</div>`;});
  }
}

const communicationTemplateDialog=document.querySelector('#communicationTemplateDialog');
const communicationTemplateForm=document.querySelector('#communicationTemplateForm');
function openTemplateDialog(id=''){
  communicationTemplateForm.reset();communicationTemplateForm.elements.id.value='';
  const item=communicationTemplates.find(template=>template.id===id);
  document.querySelector('#communicationTemplateDialogTitle').textContent=item?'Vorlage bearbeiten':'Vorlage erstellen';
  if(item){['id','name','description','category','channel','subject','body','status'].forEach(key=>{if(communicationTemplateForm.elements[key])communicationTemplateForm.elements[key].value=item[key]||'';});}
  communicationTemplateDialog.showModal();
}

function selectedCampaignContacts(){return[...campaignSelectedContacts];}
function renderCampaignContactOptions(){
  const query=(document.querySelector('#campaignContactSearch')?.value||'').trim().toLowerCase();
  const contacts=communicationCenterContacts.filter(item=>!query||`${item.name} ${item.email}`.toLowerCase().includes(query));
  document.querySelector('#campaignContactOptions').innerHTML=contacts.length?contacts.map(item=>`<label><input type="checkbox" value="${escapeHtml(item.id)}" ${campaignSelectedContacts.has(item.id)?'checked':''}><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.email)} · ${item.type==='customer'?'Teilnehmer':'Interessent'}</small></span></label>`).join(''):'<div class="empty">Keine Kontakte gefunden.</div>';
  document.querySelector('#campaignContactOptions').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{if(input.checked)campaignSelectedContacts.add(input.value);else campaignSelectedContacts.delete(input.value);updateCampaignRecipientPreview();}));
  document.querySelector('#campaignSelectedCount').textContent=`${campaignSelectedContacts.size} ausgewählt`;
}
function updateCampaignRecipientPreview(){
  const audience=document.querySelector('#campaignAudience').value;
  const counts={all:communicationCenterContacts.length,leads:communicationCenterContacts.filter(item=>item.type==='lead').length,customers:communicationCenterContacts.filter(item=>item.type==='customer').length,selected:campaignSelectedContacts.size};
  document.querySelector('#campaignRecipientPreview').textContent=`${counts[audience]||0} Empfänger`;
  document.querySelector('#campaignContactSelector').hidden=audience!=='selected';
  document.querySelector('#campaignSelectedCount').textContent=`${campaignSelectedContacts.size} ausgewählt`;
}
function localDateTimeValue(value){if(!value)return'';const date=new Date(value);if(Number.isNaN(date.getTime()))return'';const offset=date.getTimezoneOffset()*60000;return new Date(date-offset).toISOString().slice(0,16);}

const communicationCampaignDialog=document.querySelector('#communicationCampaignDialog');
const communicationCampaignForm=document.querySelector('#communicationCampaignForm');
function openCampaignDialog(id=''){
  communicationCampaignForm.reset();communicationCampaignForm.elements.id.value='';campaignSelectedContacts=new Set();
  const item=communicationCampaigns.find(campaign=>campaign.id===id);
  document.querySelector('#communicationCampaignDialogTitle').textContent=item?'Seriennachricht bearbeiten':'Versand vorbereiten';
  if(item){communicationCampaignForm.elements.id.value=item.id;communicationCampaignForm.elements.name.value=item.name;communicationCampaignForm.elements.templateId.value=item.template_id||'';communicationCampaignForm.elements.audienceType.value=item.audience_type;communicationCampaignForm.elements.subject.value=item.subject;communicationCampaignForm.elements.body.value=item.body;communicationCampaignForm.elements.scheduledAt.value=localDateTimeValue(item.scheduled_at);campaignSelectedContacts=new Set(item.audience_filter?.leadIds||[]);}
  renderCampaignContactOptions();updateCampaignRecipientPreview();communicationCampaignDialog.showModal();
}

function updateAutomationConditions(){const value=document.querySelector('#automationTrigger').value;document.querySelectorAll('[data-automation-condition]').forEach(element=>element.hidden=element.dataset.automationCondition!==value);}
const communicationAutomationDialog=document.querySelector('#communicationAutomationDialog');
const communicationAutomationForm=document.querySelector('#communicationAutomationForm');
function openAutomationDialog(id=''){
  communicationAutomationForm.reset();communicationAutomationForm.elements.id.value='';communicationAutomationForm.elements.delayValue.value='0';
  const item=communicationAutomations.find(automation=>automation.id===id);
  document.querySelector('#communicationAutomationDialogTitle').textContent=item?'Automation bearbeiten':'Automation erstellen';
  if(item){communicationAutomationForm.elements.id.value=item.id;communicationAutomationForm.elements.name.value=item.name;communicationAutomationForm.elements.triggerType.value=item.trigger_type;communicationAutomationForm.elements.templateId.value=item.template_id;communicationAutomationForm.elements.delayValue.value=String(item.delay_value);communicationAutomationForm.elements.delayUnit.value=item.delay_unit;communicationAutomationForm.elements.sendTime.value=(item.send_time||'').slice(0,5);communicationAutomationForm.elements.audienceType.value=item.audience_type;communicationAutomationForm.elements.enabled.checked=item.enabled;if(item.trigger_config?.week)communicationAutomationForm.elements.week.value=String(item.trigger_config.week);if(item.trigger_config?.inactiveDays)communicationAutomationForm.elements.inactiveDays.value=String(item.trigger_config.inactiveDays);}
  updateAutomationConditions();communicationAutomationDialog.showModal();
}

async function communicationCenterRequest(action,method,payload){
  const response=await fetch(`/api/communications?action=${encodeURIComponent(action)}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
async function setCampaignState(id,status){try{await communicationCenterRequest('campaign-state','PATCH',{id,status});communicationCenterLoaded=false;await loadCommunicationCenter();toast(status==='paused'?'Seriennachricht wurde pausiert.':'Seriennachricht wurde wieder aktiviert.');}catch(error){toast(error.message);}}
async function setAutomationState(id,enabled){try{await communicationCenterRequest('automation-state','PATCH',{id,enabled});communicationCenterLoaded=false;await loadCommunicationCenter();toast(enabled?'Automation wurde aktiviert.':'Automation wurde deaktiviert.');}catch(error){toast(error.message);}}

document.querySelector('#openCommunicationTemplate')?.addEventListener('click',()=>openTemplateDialog());
document.querySelectorAll('[data-close-template-dialog]').forEach(button=>button.addEventListener('click',()=>communicationTemplateDialog.close()));
document.querySelector('#templateSearch')?.addEventListener('input',renderTemplates);
document.querySelector('#templateCategory')?.addEventListener('change',renderTemplates);
document.querySelectorAll('[data-insert-placeholder]').forEach(button=>button.addEventListener('click',()=>{const textarea=communicationTemplateForm.elements.body,start=textarea.selectionStart,end=textarea.selectionEnd,value=button.dataset.insertPlaceholder;textarea.value=`${textarea.value.slice(0,start)}${value}${textarea.value.slice(end)}`;textarea.focus();textarea.setSelectionRange(start+value.length,start+value.length);}));
communicationTemplateForm?.addEventListener('submit',async event=>{event.preventDefault();const button=communicationTemplateForm.querySelector('[type="submit"]');button.disabled=true;try{const payload=Object.fromEntries(new FormData(communicationTemplateForm));const data=await communicationCenterRequest('template','POST',payload);communicationTemplateDialog.close();communicationCenterLoaded=false;await loadCommunicationCenter();activeCommunicationTemplateId=data.record?.id||null;renderTemplates();toast(data.message);}catch(error){toast(error.message);}finally{button.disabled=false;}});

document.querySelector('#openCommunicationCampaign')?.addEventListener('click',()=>openCampaignDialog());
document.querySelectorAll('[data-close-campaign-dialog]').forEach(button=>button.addEventListener('click',()=>communicationCampaignDialog.close()));
document.querySelector('#campaignSearch')?.addEventListener('input',renderCampaigns);
document.querySelector('#campaignAudience')?.addEventListener('change',updateCampaignRecipientPreview);
document.querySelector('#campaignContactSearch')?.addEventListener('input',renderCampaignContactOptions);
document.querySelector('#campaignTemplate')?.addEventListener('change',event=>{const item=communicationTemplates.find(template=>template.id===event.target.value);if(item){communicationCampaignForm.elements.subject.value=item.subject;communicationCampaignForm.elements.body.value=item.body;}});
communicationCampaignForm?.addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter,status=button?.dataset.campaignSubmit||'draft';button.disabled=true;try{const payload=Object.fromEntries(new FormData(communicationCampaignForm));payload.status=status;payload.selectedLeadIds=selectedCampaignContacts();if(payload.scheduledAt)payload.scheduledAt=new Date(payload.scheduledAt).toISOString();const data=await communicationCenterRequest('campaign','POST',payload);communicationCampaignDialog.close();communicationCenterLoaded=false;await loadCommunicationCenter();toast(data.message);}catch(error){toast(error.message);}finally{button.disabled=false;}});

document.querySelector('#openCommunicationAutomation')?.addEventListener('click',()=>openAutomationDialog());
document.querySelectorAll('[data-close-automation-dialog]').forEach(button=>button.addEventListener('click',()=>communicationAutomationDialog.close()));
document.querySelector('#automationTrigger')?.addEventListener('change',updateAutomationConditions);
communicationAutomationForm?.addEventListener('submit',async event=>{event.preventDefault();const button=communicationAutomationForm.querySelector('[type="submit"]');button.disabled=true;try{const payload=Object.fromEntries(new FormData(communicationAutomationForm));payload.enabled=communicationAutomationForm.elements.enabled.checked;const data=await communicationCenterRequest('automation','POST',payload);communicationAutomationDialog.close();communicationCenterLoaded=false;await loadCommunicationCenter();toast(data.message);}catch(error){toast(error.message);}finally{button.disabled=false;}});

document.querySelector('#communicationComposerTemplate')?.addEventListener('change',event=>{const item=communicationTemplates.find(template=>template.id===event.target.value);if(item){communicationComposerForm.elements.subject.value=item.subject;communicationComposerForm.elements.body.value=item.body;}});

if(document.querySelector('[data-panel="communications"].active'))loadCommunicationCenter();
