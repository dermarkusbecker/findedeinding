export function mergeClarity(weekly=[],logins=[],week=1){
 const points=weekly.filter(p=>Number.isInteger(p.score)&&p.score>=1&&p.score<=10).map(p=>({...p,source:'weekly'}));
 const extra=logins.map(p=>({score:p.score,recordedAt:p.created_at,week:Number(p.week||week)||1,source:'login',note:p.note||''}));
 const timeline=[...points,...extra].sort((a,b)=>new Date(a.recordedAt||0)-new Date(b.recordedAt||0));
 return {current:timeline.at(-1)||null,timeline};
}
export async function readLoginClarity(service,id){
 const r=await fetch(`${service.url}/rest/v1/login_clarity_checkins?user_profile_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=1000`,{headers:{apikey:service.key,Authorization:`Bearer ${service.key}`}});
 if(!r.ok)throw new Error('Aktuelle Klarheitswerte konnten nicht geladen werden.');return r.json();
}
export function clarityRecordedAt(entries,week,score){return entries.filter(e=>Number(e.week)===Number(week)).filter(e=>{const state=e.structured_data?.[`week_${week}`];return Number((Number(week)===1?state?.clarity_baseline:state?.clarity_checkin)?.score)===Number(score);}).map(e=>e.created_at).filter(Boolean).sort()[0]||null;}
