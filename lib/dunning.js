export const berlinToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
export function nextDunningStage(item,notices,stages,today){
 if(Number(item.open)<=0)return null;
 const history=notices.filter(n=>n.target_key===item.target_key);
 if(history.some(n=>['reserved','sending','failed','unknown'].includes(n.status)))return null;
 const sent=history.filter(n=>n.status==='sent').sort((a,b)=>b.stage-a.stage)[0],stage=(sent?.stage||0)+1;
 if(stage>3)return null;
 const base=sent?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date(sent.sent_at)):item.due_date;
 const due=new Date(base+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+Number(stages[stage-1].days));
 return today>=due.toISOString().slice(0,10)?stage:null;
}
export function validateDunningSettings(body){
 if(typeof body.enabled!=='boolean'||!Array.isArray(body.stages)||body.stages.length!==3)throw new Error('Bitte drei Mahnstufen angeben.');
 const allowed=new Set(['name','beleg','betrag','faellig','bank']);
 const stages=body.stages.map(s=>{
  if(!Number.isInteger(Number(s.days))||Number(s.days)<1||Number(s.days)>365)throw new Error('Der Abstand jeder Mahnstufe muss zwischen 1 und 365 Tagen liegen.');
  const subject=String(s.subject||'').trim(),text=String(s.body||'').trim();
  if(!subject||subject.length>150||/[\r\n]/.test(subject)||text.length<20||text.length>5000)throw new Error('Bitte Betreff und Nachricht jeder Mahnstufe prüfen.');
  for(const m of (subject+' '+text).matchAll(/{{(.*?)}}/g))if(!allowed.has(m[1]))throw new Error('Unbekannter Platzhalter: '+m[0]);
  if(!text.includes('{{betrag}}')||!text.includes('{{beleg}}'))throw new Error('Jede Mahnung muss {{betrag}} und {{beleg}} enthalten.');
  return{days:Number(s.days),subject,body:text};
 });return{enabled:body.enabled,stages,updated_at:new Date().toISOString()};
}
export function dunningMessage(item,profile,stage,settings){
 const values={name:profile.name||'du',beleg:item.reference,betrag:Number(item.open).toLocaleString('de-DE',{style:'currency',currency:'EUR'}),faellig:new Date(item.due_date+'T12:00:00Z').toLocaleDateString('de-DE',{timeZone:'Europe/Berlin'}),bank:settings?.iban?`Bankverbindung: ${settings.iban}\nKontoinhaber: ${settings.issuer_name}`:'Bitte verwende die Zahlungsinformationen auf deiner Rechnung.'};
 const render=text=>text.replace(/{{(name|beleg|betrag|faellig|bank)}}/g,(_,key)=>values[key]);return{subject:render(stage.subject),body:render(stage.body)};
}
// The DB provides single-use sending gates. An ambiguous SMTP result is never retried automatically.
export async function processDunning({query,all,transport,mailbox,branding,signature,today=berlinToday(),renderEmail,maxMilliseconds=42000}){
 const started=Date.now(),settings=(await query('finance_dunning_settings?id=eq.default'))[0],result={sent:0,skipped:0,failed:0,unknown:0,remaining:0};
 if(!settings?.enabled)return{...result,disabled:true};
 await transport.verify();
 const [items,notices,finance]=await Promise.all([all('finance_due_items?open=gt.0&order=due_date,target_key'),all('finance_dunning_notices?select=target_key,stage,status,sent_at&order=id'),query('finance_settings?id=eq.default')]);
 for(const item of items){
  const stage=nextDunningStage(item,notices,settings.stages,today);if(!stage)continue;
  if(Date.now()-started>maxMilliseconds){result.remaining++;continue;}
  const [profile]=await query(`user_profiles?id=eq.${item.customer_id}&role=eq.user&select=id,name,email`);
  if(!profile||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(profile.email||'')){result.skipped++;continue;}
  const message=dunningMessage(item,profile,settings.stages[stage-1],finance[0]);
  const content=renderEmail({...message,branding,signature});
  const claim=await query('rpc/finance_dunning_claim',{method:'POST',body:JSON.stringify({p_key:item.target_key,p_stage:stage,p_subject:message.subject,p_body:content.text,p_recipient:profile.email,p_amount:Number(item.open)})});
  if(!claim){result.skipped++;continue;}
  const ready=await query('rpc/finance_dunning_start',{method:'POST',body:JSON.stringify({p_notice:claim.id})});if(!ready){result.skipped++;continue;}
  let status='sent',error=null;
  try{
   const info=await transport.sendMail({from:{name:branding.brand_name||'Finde dein Ding',address:mailbox},to:profile.email,subject:message.subject,html:content.html,text:content.text,messageId:`<dunning-${claim.id}@${mailbox.split('@')[1]}>`,disableFileAccess:true,disableUrlAccess:true});
   if(!info.accepted?.some(a=>String(a).toLowerCase()===profile.email.toLowerCase())){status='failed';error='Empfänger vom Mailserver nicht angenommen.';}
  }catch(e){status=e.code==='EAUTH'||Number(e.responseCode)>=400?'failed':'unknown';error=status==='failed'?'Mailserver hat den Versand abgelehnt. Zugang und Empfänger prüfen.':'Versandergebnis unklar. Vor erneutem Versand im Postfach prüfen.';}
  // If final persistence fails, leave sending in place: a retry must not send another copy.
  await query('rpc/finance_dunning_finish',{method:'POST',body:JSON.stringify({p_notice:claim.id,p_status:status,p_error:error})});result[status]++;
 }
 return result;
}
