export async function checkIntegrationHealth({service,openaiKey,openaiModel,googleToken,whatsappToken,whatsappId,whatsappVersion='v23.0'},request=fetch){
 const probe=async(url,headers)=>{try{const response=await request(url,{headers,signal:AbortSignal.timeout(8000)});await response.body?.cancel();return {ok:response.ok,status:response.status};}catch{return {ok:false,status:null};}};
 const tasks=[['supabase',()=>probe(`${service.url}/rest/v1/user_profiles?select=id&limit=1`,{apikey:service.key,Authorization:`Bearer ${service.key}`})],['supabase_auth_mail',()=>probe(`${service.url}/auth/v1/health`,{apikey:service.key})]];
 if(openaiKey)tasks.push(['openai',()=>probe(`https://api.openai.com/v1/models/${encodeURIComponent(openaiModel)}`,{Authorization:`Bearer ${openaiKey}`})]);
 if(googleToken)tasks.push(['google_calendar',async()=>{try{return await probe('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1',{Authorization:`Bearer ${await googleToken()}`});}catch{return {ok:false,status:null};}}]);
 if(whatsappToken&&whatsappId)tasks.push(['whatsapp_business',()=>probe(`https://graph.facebook.com/${whatsappVersion}/${encodeURIComponent(whatsappId)}?fields=id`,{Authorization:`Bearer ${whatsappToken}`})]);
 return Object.fromEntries(await Promise.all(tasks.map(async([id,task])=>[id,await task()])));
}
export function applyIntegrationHealth(registry,checks){
 registry.integrations=registry.integrations.map(item=>{
  const check=checks[item.id];if(!check)return item;
  const detail=item.id==='supabase_auth_mail'?'Auth-Dienst erreichbar. Die E-Mail-Zustellung wurde nicht getestet.':item.id==='openai'?'API-Schlüssel und Modellzugriff geprüft. Es wurde keine KI-Anfrage erzeugt.': 'Lesezugriff auf die Schnittstelle erfolgreich geprüft.';
  return {...item,status:check.ok?{key:'active',label:'Verbindung geprüft',tone:'positive'}:{key:'missing',label:'Prüfung fehlgeschlagen',tone:'danger'},detail:check.ok?detail:`Verbindung fehlgeschlagen${check.status?` (HTTP ${check.status})`: ' oder Zeitüberschreitung'}. Zugang und Berechtigungen prüfen.`};
 });
 if(checks.openai&&!checks.openai.ok)registry.agents=registry.agents.map(item=>item.status.key==='active'?{...item,status:{key:'missing',label:'KI-Verbindung prüfen',tone:'danger'}}:item);
 registry.summary.activeAgents=registry.agents.filter(item=>item.status.key==='active').length;
 registry.summary.activeIntegrations=registry.integrations.filter(item=>item.status.key==='active').length;
 return registry;
}
