import { requireCurrentAdmin } from '../lib/user-auth.js';

function config(){const url=process.env.SUPABASE_URL?.replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;return url&&key?{url,key}:null;}
const headers=(key,extra={})=>({apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...extra});

export default async function handler(request,response){
  if(!await requireCurrentAdmin(request,response))return;
  const service=config(),participantId=request.query?.participantId||request.body?.participantId;
  if(!service)return response.status(503).json({error:'Supabase ist noch nicht konfiguriert.'});
  if(!participantId)return response.status(400).json({error:'Teilnehmer-ID fehlt.'});
  if(request.method==='GET'){
    const result=await fetch(`${service.url}/rest/v1/week_gates?user_profile_id=eq.${encodeURIComponent(participantId)}&select=*&order=week.asc,gate_key.asc`,{headers:headers(service.key)});const gates=await result.json();return response.status(result.status).json(result.ok?{gates}:{error:gates.message});
  }
  if(request.method==='PATCH'){
    const gateId=request.body?.gateId,completed=Boolean(request.body?.completed);if(!gateId)return response.status(400).json({error:'Gate-ID fehlt.'});
    const gateResult=await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gateId)}&user_profile_id=eq.${encodeURIComponent(participantId)}`,{method:'PATCH',headers:headers(service.key,{Prefer:'return=representation'}),body:JSON.stringify({completed_at:completed?new Date().toISOString():null})});const changed=await gateResult.json();if(!gateResult.ok||!changed[0])return response.status(gateResult.status).json({error:changed.message||'Gate nicht gefunden.'});
    const week=changed[0].week,remainingResult=await fetch(`${service.url}/rest/v1/week_gates?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.${week}&required=eq.true&completed_at=is.null&select=id`,{headers:headers(service.key)});const remaining=await remainingResult.json();
    if(completed&&remaining.length===0){const nextWeek=Math.min(8,week+1),status=week===8?'FINAL_REPORT':`WEEK_${nextWeek}`;await fetch(`${service.url}/rest/v1/participant_progress?user_profile_id=eq.${encodeURIComponent(participantId)}`,{method:'PATCH',headers:headers(service.key),body:JSON.stringify({current_week:nextWeek,process_status:status,last_activity_at:new Date().toISOString(),updated_at:new Date().toISOString()})});}
    return response.status(200).json({gate:changed[0],weekComplete:remaining.length===0});
  }
  return response.status(405).json({error:'Methode nicht erlaubt.'});
}
