const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={manual:'Manuell',lead_follow_up:'Wiedervorlage',clarity_decline:'Klarheitsrückgang',customer_question:'Kundenfrage'};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
let tasks=[],contacts=[],editing=null,busy=false;
const api=async(method='GET',body)=>{const response=await fetch('/api/leads?action=tasks',{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Aufgaben konnten nicht geladen werden.');return data;};
function render(){
 const date=today(),query=$('#taskSearch').value.toLocaleLowerCase('de-DE'),status=$('#taskStatus').value,source=$('#taskSource').value;
 const overdue=item=>!item.completed&&item.due_at&&item.due_at<date;
 $('#taskStatistics').innerHTML=[['Offen',tasks.filter(item=>!item.completed).length],['Heute fällig',tasks.filter(item=>!item.completed&&item.due_at===date).length],['Überfällig',tasks.filter(overdue).length],['Erledigt',tasks.filter(item=>item.completed).length]].map(([label,count])=>`<div><span>${label}</span><strong>${count}</strong></div>`).join('');
 const visible=tasks.filter(item=>(!source||item.source===source)&&`${item.title} ${item.details} ${item.contactName}`.toLocaleLowerCase('de-DE').includes(query)&&(status==='all'||status==='open'&&!item.completed||status==='completed'&&item.completed||status==='today'&&!item.completed&&item.due_at===date||status==='overdue'&&overdue(item))).sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.due_at||'9999').localeCompare(b.due_at||'9999')||b.created_at.localeCompare(a.created_at));
 $('#taskList').innerHTML=visible.length?visible.map(item=>`<article class="crm-task ${overdue(item)?'overdue':''} ${item.completed?'completed':''}"><div><p>${esc(labels[item.source]||item.source)} · ${item.completed?'Erledigt':overdue(item)?'Überfällig':'Offen'}</p><h2>${esc(item.title)}</h2><span>${esc(item.contactName)}</span><p class="crm-task-copy">${esc(item.details)}</p><small>${item.due_at?`Fällig: ${new Date(item.due_at+'T12:00:00').toLocaleDateString('de-DE')}`:'Ohne Fälligkeit'}</small></div><div class="crm-task-actions"><button type="button" class="primary" data-task-edit="${esc(item.key)}">Bearbeiten</button>${item.contactId?`<button type="button" class="secondary" data-task-contact="${esc(item.key)}">Akte öffnen ↗</button>`:''}</div></article>`).join(''):'<div class="empty">Keine Aufgaben für diese Auswahl.</div>';
}
async function load(){try{$('#taskLoadStatus').textContent='Aufgaben werden geladen …';const data=await api();tasks=data.tasks;contacts=data.contacts;render();$('#taskLoadStatus').textContent=`Aktualisiert ${new Date(data.checkedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} · Änderungen werden direkt in den verknüpften Akten gespeichert.`;}catch(error){$('#taskLoadStatus').textContent=error.message;}}
function openEditor(item=null){
 editing=item;const form=$('#taskEditorForm');form.reset();$('#taskSaveStatus').textContent='';const question=item?.kind==='question';
 $('#taskEditorTitle').textContent=question?'Kundenfrage bearbeiten':item?'Aufgabe bearbeiten':'Neue Aufgabe';
 form.elements.leadId.innerHTML='<option value="">Intern · ohne Kontakt</option>'+contacts.map(contact=>`<option value="${esc(contact.id)}">${esc(contact.name)}${contact.converted_user_profile_id?' · Kunde':' · Interessent'}</option>`).join('');
 form.elements.leadId.value=item?.lead_id||'';form.elements.leadId.disabled=Boolean(item);
 form.elements.leadId.closest('label').hidden=question;
 form.elements.title.value=item?.title||'';form.elements.title.readOnly=question;
 form.elements.details.value=item?.details||'';form.elements.details.readOnly=question;
 form.elements.dueAt.value=item?.due_at||'';$('#taskDueLabel').hidden=question;
 form.elements.adminNote.value=item?.admin_note||'';$('#taskNoteLabel').hidden=!question;
 form.elements.completed.checked=item?.completed===true;form.elements.completed.closest('label').hidden=!item;
 $('#taskEditor').showModal();
}
$('#taskEditorForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const form=event.currentTarget;if(!form.reportValidity())return;
 busy=true;$('#saveTask').disabled=true;$('#closeTaskEditor').disabled=true;$('#taskSaveStatus').textContent='Wird gespeichert …';
 try{await api(editing?'PATCH':'POST',{id:editing?.id,kind:editing?.kind,updatedAt:editing?.updated_at,leadId:editing?.lead_id||form.elements.leadId.value||null,title:form.elements.title.value,details:form.elements.details.value,dueAt:form.elements.dueAt.value||null,adminNote:form.elements.adminNote.value,completed:form.elements.completed.checked});$('#taskEditor').close();await load();window.dispatchEvent(new Event('crm:tasks-changed'));}catch(error){$('#taskSaveStatus').textContent=error.message;}finally{busy=false;$('#saveTask').disabled=false;$('#closeTaskEditor').disabled=false;}
});
$('#taskEditor').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('#closeTaskEditor').addEventListener('click',()=>{if(!busy)$('#taskEditor').close();});
$('#createTask').addEventListener('click',()=>openEditor());$('#refreshTasks').addEventListener('click',load);
for(const id of ['taskSearch','taskStatus','taskSource'])$('#'+id).addEventListener(id==='taskSearch'?'input':'change',render);
$('#taskList').addEventListener('click',event=>{const edit=event.target.closest('[data-task-edit]'),contact=event.target.closest('[data-task-contact]');if(edit)openEditor(tasks.find(item=>item.key===edit.dataset.taskEdit));if(contact){const item=tasks.find(item=>item.key===contact.dataset.taskContact);window.dispatchEvent(new CustomEvent('crm:task-contact',{detail:{type:item.contactType,id:item.contactId}}));}});
window.addEventListener('crm:view',event=>{if(event.detail==='tasks')load();});
if(document.querySelector('[data-panel="tasks"]').classList.contains('active'))load();

window.addEventListener('crm:task-open',async event=>{await load();const item=tasks.find(task=>task.kind==='task'&&task.id===event.detail);if(item)openEditor(item);});
