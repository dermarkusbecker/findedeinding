const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=(value,max)=>String(value||'').trim().slice(0,max);
export function normalizeTask(body){
 const title=clean(body.title,220),details=clean(body.details,2000),due=body.dueAt||null;
 if(!title)throw fail('Bitte einen Aufgabentitel eingeben.');
 if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(new Date(due).getTime())||new Date(due).toISOString().slice(0,10)!==due))throw fail('Bitte ein gültiges Fälligkeitsdatum wählen.');
 if(body.leadId!==null&&!uuid(body.leadId))throw fail('Bitte einen gültigen Kontakt auswählen.');
 return {title,details:details||null,due_at:due,lead_id:body.leadId};
}
export function buildTaskList(tasks,questions,leads,profiles){
 const leadMap=new Map(leads.map(item=>[item.id,item])),profileMap=new Map(profiles.map(item=>[item.id,item]));
 return [
  ...tasks.map(task=>{const lead=leadMap.get(task.lead_id);return {...task,kind:'task',key:`task:${task.id}`,source:task.task_type||'manual',contactName:lead?.name||'Intern · ohne Kontakt',contactType:lead?.converted_user_profile_id?'customer':lead?'lead':null,contactId:lead?.converted_user_profile_id||lead?.id||null};}),
  ...questions.map(question=>({id:question.id,key:`question:${question.id}`,kind:'question',title:question.question.startsWith('[Klarheits-Nachgespräch')?'Klarheitsrückgang besprechen':`Kundenfrage · Woche ${question.week}`,details:question.question,due_at:null,completed:question.status!=='open',source:question.question.startsWith('[Klarheits-Nachgespräch')?'clarity_decline':'customer_question',admin_note:question.admin_note||'',created_at:question.created_at,updated_at:question.updated_at,contactName:profileMap.get(question.user_profile_id)?.name||'Kunde',contactType:'customer',contactId:question.user_profile_id})),
 ];
}
export async function handleCrmTasks(request,response,service){
 const query=async(path,options={})=>{
  const result=await fetch(`${service.url}/rest/v1/${path}`,{...options,headers:{apikey:service.key,Authorization:`Bearer ${service.key}`,'Content-Type':'application/json',Prefer:'return=representation'}});
  const data=await result.json();if(!result.ok)throw fail(data.message||'Aufgaben konnten nicht gespeichert werden.',result.status);return data;
 };
 const all=async path=>{const rows=[];for(let offset=0;;offset+=1000){const page=await query(`${path}&limit=1000&offset=${offset}`);rows.push(...page);if(page.length<1000)return rows;}};
 response.setHeader('Cache-Control','private, no-store');
 if(request.method==='GET'){
  const [tasks,questions,leads,profiles]=await Promise.all([
   all('lead_tasks?select=*&order=created_at.desc,id.asc'),all('customer_questions?select=*&order=created_at.desc,id.asc'),
   all('leads?select=id,name,email,converted_user_profile_id&order=name.asc,id.asc'),all('user_profiles?role=eq.user&select=id,name&order=id.asc'),
  ]);
  return response.status(200).json({tasks:buildTaskList(tasks,questions,leads,profiles),contacts:leads,checkedAt:new Date().toISOString()});
 }
 const body=request.body||{};
 if(request.method==='POST'){
  const payload=normalizeTask(body);
  if(payload.lead_id&&!(await query(`leads?id=eq.${payload.lead_id}&select=id`)).length)throw fail('Kontakt nicht gefunden.',404);
  const rows=await query('lead_tasks',{method:'POST',body:JSON.stringify({...payload,task_type:'manual'})});
  return response.status(201).json({record:rows[0]});
 }
 if(request.method==='PATCH'){
  if(typeof body.completed!=='boolean')throw fail('Bitte einen gültigen Aufgabenstatus übermitteln.');
  if(!uuid(body.id)||!['task','question'].includes(body.kind))throw fail('Ungültige Aufgabe.');
  const table=body.kind==='task'?'lead_tasks':'customer_questions';
  const existing=(await query(`${table}?id=eq.${body.id}&select=*`))[0];if(!existing)throw fail('Aufgabe nicht gefunden.',404);
  let changes;
  if(body.kind==='question'){
   if(body.completed&&!clean(body.adminNote,2000))throw fail('Bitte dokumentiere die Bearbeitung der Kundenfrage.');
   changes={status:body.completed?'answered':'open',admin_note:clean(body.adminNote,2000)||null};
  }else{
   changes=normalizeTask({...body,leadId:existing.lead_id});
   delete changes.lead_id;
   changes.completed=body.completed===true;
  }
  if(body.updatedAt!==existing.updated_at)throw fail('Diese Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.',409);
  const rows=await query(`${table}?id=eq.${body.id}&updated_at=eq.${encodeURIComponent(existing.updated_at)}`,{method:'PATCH',body:JSON.stringify({...changes,updated_at:new Date().toISOString()})});
  if(!rows.length)throw fail('Diese Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.',409);
  return response.status(200).json({record:rows[0]});
 }
 return response.status(405).json({error:'Methode nicht erlaubt.'});
}
