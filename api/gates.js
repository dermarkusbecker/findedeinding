import { defaultProgramDefinition } from '../lib/program-builder.js';
import { requireCurrentAdmin } from '../lib/user-auth.js';
import { gateTemplateSettingRows, gateWeekDefaults, gateWeekSettingRows } from '../lib/gate-templates.js';
import { getParticipantProgramAccess } from '../lib/program-access-service.js';

function config(){const url=process.env.SUPABASE_URL?.replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;return url&&key?{url,key}:null;}
const headers=(key,extra={})=>({apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...extra});

async function responseJson(result,fallback){const data=await result.json().catch(()=>({}));if(!result.ok)throw Object.assign(new Error(data.message||fallback),{status:result.status});return data;}
async function readGateSettings(service){
  const [weeksResult,fieldsResult]=await Promise.all([
    fetch(`${service.url}/rest/v1/gate_week_settings?select=week,title,description,default_title,default_description,updated_at&order=week.asc`,{headers:headers(service.key)}),
    fetch(`${service.url}/rest/v1/gate_template_settings?select=gate_key,week,label,default_label,sort_order,updated_at&order=week.asc,sort_order.asc`,{headers:headers(service.key)}),
  ]);
  const weeks=await responseJson(weeksResult,'Die Gate-Bereiche konnten nicht geladen werden.');
  const fields=await responseJson(fieldsResult,'Die Gate-Felder konnten nicht geladen werden.');
  return {weeks,fields};
}
async function ensureGateSettings(service){
  let settings=await readGateSettings(service);
  const weekKeys=new Set(settings.weeks.map(item=>Number(item.week))),fieldKeys=new Set(settings.fields.map(item=>item.gate_key));
  const missingWeeks=gateWeekSettingRows().filter(item=>!weekKeys.has(item.week));
  const missingFields=gateTemplateSettingRows().filter(item=>!fieldKeys.has(item.gate_key));
  if(missingWeeks.length)await responseJson(await fetch(`${service.url}/rest/v1/gate_week_settings`,{method:'POST',headers:headers(service.key,{Prefer:'resolution=ignore-duplicates,return=minimal'}),body:JSON.stringify(missingWeeks)}),'Gate-Bereiche konnten nicht initialisiert werden.');
  if(missingFields.length)await responseJson(await fetch(`${service.url}/rest/v1/gate_template_settings`,{method:'POST',headers:headers(service.key,{Prefer:'resolution=ignore-duplicates,return=minimal'}),body:JSON.stringify(missingFields)}),'Gate-Felder konnten nicht initialisiert werden.');
  if(missingWeeks.length||missingFields.length)settings=await readGateSettings(service);
  return settings;
}
function serializeGateSettings(settings){return settings.weeks.map(week=>({...week,items:settings.fields.filter(field=>Number(field.week)===Number(week.week)).map(field=>({gateKey:field.gate_key,label:field.label,defaultLabel:field.default_label,sortOrder:field.sort_order,updatedAt:field.updated_at}))}));}
async function handleGateSettings(request,response,service,admin){
  if(request.method==='GET')return response.status(200).json({weeks:serializeGateSettings(await ensureGateSettings(service))});
  if(request.method!=='PATCH')return response.status(405).json({error:'Methode nicht erlaubt.'});
  const week=Number(request.body?.week),definition=gateWeekDefaults.find(item=>item.week===week),reset=request.body?.action==='reset';
  if(!definition)return response.status(400).json({error:'Diese Prozesswoche ist ungültig.'});
  const allowed=gateTemplateSettingRows().filter(item=>item.week===week);
  const submitted=Array.isArray(request.body?.items)?request.body.items:[];
  const title=reset?definition.title:String(request.body?.title||'').trim();
  const description=reset?definition.description:String(request.body?.description||'').trim();
  const items=reset?allowed.map(item=>({gateKey:item.gate_key,label:item.default_label})):submitted.map(item=>({gateKey:String(item?.gateKey||''),label:String(item?.label||'').trim()}));
  if(title.length<2||title.length>120)return response.status(400).json({error:'Der Gate-Titel muss zwischen 2 und 120 Zeichen lang sein.'});
  if(description.length<5||description.length>600)return response.status(400).json({error:'Die Beschreibung muss zwischen 5 und 600 Zeichen lang sein.'});
  if(items.length!==allowed.length||new Set(items.map(item=>item.gateKey)).size!==allowed.length||items.some(item=>!allowed.some(allowedItem=>allowedItem.gate_key===item.gateKey)||item.label.length<2||item.label.length>240))return response.status(400).json({error:'Alle Gate-Felder müssen vollständig und mit 2 bis 240 Zeichen übermittelt werden.'});
  await ensureGateSettings(service);
  const now=new Date().toISOString(),audit={updated_at:now,updated_by:admin.profile.id};
  await responseJson(await fetch(`${service.url}/rest/v1/gate_week_settings?week=eq.${week}`,{method:'PATCH',headers:headers(service.key,{Prefer:'return=representation'}),body:JSON.stringify({title,description,...audit})}),'Der Gate-Bereich konnte nicht gespeichert werden.');
  for(const item of items){
    const templateResult=await fetch(`${service.url}/rest/v1/gate_template_settings?week=eq.${week}&gate_key=eq.${encodeURIComponent(item.gateKey)}`,{method:'PATCH',headers:headers(service.key),body:JSON.stringify({label:item.label,...audit})});
    if(!templateResult.ok)await responseJson(templateResult,'Ein Gate-Feld konnte nicht gespeichert werden.');
    const activeGateResult=await fetch(`${service.url}/rest/v1/week_gates?week=eq.${week}&gate_key=eq.${encodeURIComponent(item.gateKey)}`,{method:'PATCH',headers:headers(service.key),body:JSON.stringify({label:item.label})});
    if(!activeGateResult.ok)await responseJson(activeGateResult,'Bestehende Kundengates konnten nicht aktualisiert werden.');
  }
  return response.status(200).json({weeks:serializeGateSettings(await readGateSettings(service)),reset});
}

export default async function handler(request,response){
  const admin=await requireCurrentAdmin(request,response,['settings','program']);if(!admin)return;
  const service=config(),participantId=request.query?.participantId||request.body?.participantId;
  if(!service)return response.status(503).json({error:'Supabase ist noch nicht konfiguriert.'});
  if(request.query?.action==='catalog') {
    try {
      if(request.method==='PATCH') {
        const {tariffId,versionId}=request.body||{};
        const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if(!uuid.test(tariffId||'')||(versionId!==null&&!uuid.test(versionId||'')))return response.status(400).json({error:'Gültigen Tarif und veröffentlichten Prozess wählen.'});
        const rows=await responseJson(await fetch(`${service.url}/rest/v1/service_tariffs?id=eq.${encodeURIComponent(tariffId)}`,{method:'PATCH',headers:headers(service.key,{Prefer:'return=representation'}),body:JSON.stringify({program_version_id:versionId,updated_at:new Date().toISOString()})}),'Prozesszuordnung konnte nicht gespeichert werden.');
        if(!rows.length)return response.status(404).json({error:'Tarif nicht gefunden.'});
        return response.status(200).json({tariff:rows[0]});
      }
      if(request.method!=='GET')return response.status(405).json({error:'Methode nicht erlaubt.'});
      const [tariffs,versions]=await Promise.all([
        fetch(`${service.url}/rest/v1/service_tariffs?select=id,name,is_active,is_default,program_version_id&order=is_default.desc,sort_order.asc,name.asc`,{headers:headers(service.key)}).then(r=>responseJson(r,'Tarife konnten nicht geladen werden.')),
        fetch(`${service.url}/rest/v1/program_versions?select=id,version,definition,published_at&order=version.desc`,{headers:headers(service.key)}).then(r=>responseJson(r,'Prozesse konnten nicht geladen werden.')),
      ]);
      response.setHeader('Cache-Control','private, no-store');
      return response.status(200).json({tariffs,versions,defaultDefinition:defaultProgramDefinition()});
    } catch(error){return response.status(error.status||500).json({error:error.message});}
  }
  if(request.query?.action==='settings'){
    try{return await handleGateSettings(request,response,service,admin);}catch(error){return response.status(error.status||500).json({error:error.message||'Gate-Einstellungen konnten nicht verarbeitet werden.'});}
  }
  if(!participantId)return response.status(400).json({error:'Teilnehmer-ID fehlt.'});
  if(request.method==='GET'){
    const result=await fetch(`${service.url}/rest/v1/week_gates?user_profile_id=eq.${encodeURIComponent(participantId)}&select=*&order=week.asc,gate_key.asc`,{headers:headers(service.key)});const gates=await result.json();return response.status(result.status).json(result.ok?{gates}:{error:gates.message});
  }
  if(request.method==='PATCH'){
    const gateId=request.body?.gateId,completed=Boolean(request.body?.completed);if(!gateId)return response.status(400).json({error:'Gate-ID fehlt.'});
    const program=await getParticipantProgramAccess(participantId);
    const targetGate=program.gates.find(gate=>gate.id===gateId);
    if(!targetGate)return response.status(404).json({error:'Gate nicht gefunden.'});
    if(completed&&Number(targetGate.week)>=1&&!program.access.canAccessWeek(targetGate.week))return response.status(409).json({error:`Woche ${targetGate.week} ist zeitlich noch gesperrt. Pflichtfelder können erst ab dem Freischaltungsdatum abgeschlossen werden.`});
    const gateResult=await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gateId)}&user_profile_id=eq.${encodeURIComponent(participantId)}`,{method:'PATCH',headers:headers(service.key,{Prefer:'return=representation'}),body:JSON.stringify({completed_at:completed?new Date().toISOString():null})});const changed=await gateResult.json();if(!gateResult.ok||!changed[0])return response.status(gateResult.status).json({error:changed.message||'Gate nicht gefunden.'});
    const week=changed[0].week,remainingResult=await fetch(`${service.url}/rest/v1/week_gates?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.${week}&required=eq.true&completed_at=is.null&select=id`,{headers:headers(service.key)});const remaining=await remainingResult.json();
    return response.status(200).json({gate:changed[0],weekComplete:remaining.length===0});
  }
  return response.status(405).json({error:'Methode nicht erlaubt.'});
}
