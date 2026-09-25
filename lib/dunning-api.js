import {cleanupMobileAccounts} from './mobile-cleanup.js';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import {supabaseAuthConfig,authHeaders} from './user-auth.js';
import {stratoMailConfig} from './strato-mail.js';
import {renderBrandedEmail} from './branded-email.js';
import {processDunning,validateDunningSettings,dunningMessage} from './dunning.js';
export function cronAuthorized(request,secret=process.env.CRON_SECRET){const got=String(request.headers?.authorization||''),expected=`Bearer ${secret}`;return Boolean(secret)&&Buffer.byteLength(got)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(got),Buffer.from(expected));}
export async function handleDunningCron(request,response){
 response.setHeader('Cache-Control','private, no-store');
 if(!cronAuthorized(request))return response.status(401).json({error:'Nicht autorisiert.'});
 if(request.method!=='GET')return response.status(405).json({error:'Methode nicht erlaubt.'});
 const config=supabaseAuthConfig(),mail=stratoMailConfig();
 if(!config?.serviceKey||!mail)return response.status(503).json({error:'Mail- oder Datenbankkonfiguration fehlt.'});
 const query=async(path,options={})=>{const r=await fetch(`${config.url}/rest/v1/${path}`,{...options,headers:{...authHeaders(config.serviceKey),Prefer:'return=representation'}});if(!r.ok)throw new Error('Mahnprotokoll konnte nicht verarbeitet werden.');return r.status===204?null:r.json();};
 const all=async path=>{let rows=[];for(let offset=0;;offset+=500){const page=await query(`${path}&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)return rows;}};
 const transport=nodemailer.createTransport({host:'smtp.strato.de',port:465,secure:true,auth:mail,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:10000,logger:false,debug:false});
 try{
  if(request.query?.check==='1'){await transport.verify();return response.json({ok:true,smtp:true,automatic:Boolean((await query('finance_dunning_settings?id=eq.default'))[0]?.enabled)});}
  await cleanupMobileAccounts(config,query);
  const [brands,signatures]=await Promise.all([query('system_branding?id=eq.default'),query('communication_signatures?active=eq.true&order=is_default.desc,created_at&limit=1')]);
  const result=await processDunning({query,all,transport,mailbox:mail.user,branding:brands[0]||{},signature:signatures[0]||{signer_name:'Markus Becker',company_name:'Finde dein Ding'},renderEmail:renderBrandedEmail});
  await query('finance_dunning_settings?id=eq.default',{method:'PATCH',body:JSON.stringify({last_run_at:new Date().toISOString(),last_result:result})});return response.json({ok:true,...result});
 }catch{
  await query('finance_dunning_settings?id=eq.default',{method:'PATCH',body:JSON.stringify({last_run_at:new Date().toISOString(),last_result:{error:'Mahnlauf nicht abgeschlossen. STRATO-Zugang und Versandprotokoll prüfen.'}})}).catch(()=>{});
  return response.status(503).json({error:'Mahnlauf nicht abgeschlossen. STRATO-Zugang und Versandprotokoll prüfen.'});
 }finally{transport.close();}
}
export async function handleDunningSettings(request,response,{query,all,user}){
 if(request.method==='POST'&&request.query.action==='finance-dunning-review'){
  const b=request.body||{};
  if(b.confirmed!==true||!['retry','confirm_sent'].includes(b.operation)||!/^[0-9a-f-]{36}$/i.test(b.id||''))return response.status(400).json({error:'Versandprüfung bitte ausdrücklich bestätigen.'});
  await query('rpc/finance_dunning_review',{method:'POST',body:JSON.stringify({p_notice:b.id,p_action:b.operation,p_actor:user.profile?.id||user.profileId||user.name||'CRM-Administrator'})});return response.json({ok:true});
 }
 if(request.method==='PATCH'){
  let payload;try{payload=validateDunningSettings(request.body||{});}catch(e){return response.status(400).json({error:e.message});}
  return response.json({settings:(await query('finance_dunning_settings?id=eq.default',{method:'PATCH',body:JSON.stringify(payload)}))[0]});
 }
 if(request.method==='POST'&&request.query.action==='finance-dunning-preview'){
  let settings;try{settings=validateDunningSettings({...request.body,enabled:true});}catch(e){return response.status(400).json({error:e.message});}
  const [branding,signatures,finance]=await Promise.all([query('system_branding?id=eq.default'),query('communication_signatures?active=eq.true&order=is_default.desc,created_at&limit=1'),query('finance_settings?id=eq.default')]);
  const index=Math.max(0,Math.min(2,Number(request.body.stage)||0)),message=dunningMessage({reference:'FDD-RE-2026-000001 · Rate 1',due_date:'2026-09-01',open:149},{name:'Alex Beispiel'},settings.stages[index],finance[0]);
  return response.json({subject:message.subject,...renderBrandedEmail({...message,branding:branding[0],signature:signatures[0]})});
 }
 if(request.method!=='GET')return response.status(405).json({error:'Methode nicht erlaubt.'});
 const [settings,notices]=await Promise.all([query('finance_dunning_settings?id=eq.default'),query('finance_dunning_notices?select=id,stage,status,amount,sent_at,created_at,error,subject,recipient&order=created_at.desc&limit=100')]);
 return response.json({settings:settings[0],notices,mailConfigured:Boolean(stratoMailConfig()),cronConfigured:Boolean(process.env.CRON_SECRET)});
}
