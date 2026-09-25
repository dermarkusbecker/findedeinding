import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import {createSession,sessionFromRequest} from './auth.js';
import {authenticateUser,authHeaders,profileById,supabaseAuthConfig} from './user-auth.js';
import {INTAKE_QUESTIONS,normalizeIntake} from './intake.js';
import {stratoMailConfig} from './strato-mail.js';
import {renderBrandedEmail} from './branded-email.js';
import {completeCustomerDeletion} from './customer-deletion.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=value=>crypto.createHmac('sha256',process.env.AUTH_SECRET).update(String(value)).digest('hex');
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||'');
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
export async function activeMobileSession(config,session){
 if(!session.mobileSessionId)return true;
 const r=await fetch(`${config.url}/rest/v1/mobile_sessions?id=eq.${session.mobileSessionId}&profile_id=eq.${session.profileId}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id`,{headers:authHeaders(config.serviceKey)});
 return r.ok&&(await r.json()).length===1;
}
export async function handleMobile(request,response){
 response.setHeader('Cache-Control','private, no-store');
 if(request.headers?.['sec-fetch-site']==='cross-site')return response.status(403).json({error:'Diese Aktion muss in der App gestartet werden.'});
 // Server release gate; enable only after native acceptance and mail verification.
 if(process.env.MOBILE_APP_ENABLED!=='true')return response.status(503).json({error:'Der App-Zugang befindet sich noch in der Vorbereitung.'});
 const config=supabaseAuthConfig();if(!config)return response.status(503).json({error:'App-Zugang nicht konfiguriert.'});
 const headers=authHeaders(config.serviceKey),query=async(path,options={})=>{const r=await fetch(`${config.url}/rest/v1/${path}`,{...options,headers:{...headers,Prefer:'return=representation',...options.headers},signal:AbortSignal.timeout(15000)}),v=await r.json().catch(()=>null);if(!r.ok)throw fail('Der Vorgang konnte nicht gespeichert werden. Bitte erneut versuchen.',r.status>=500?503:400);return v;};
 const action=request.query.action,b=request.body||{};
 const sessionResult=(p,id,refresh)=>({token:createSession(p.email,'user',{profileId:p.id,participantId:p.id,userId:p.auth_user_id,name:p.name,email:p.email,permissions:p.permissions||[],mobileSessionId:id,mustChangePassword:p.must_change_password===true}),refreshToken:refresh,user:{id:p.id,name:p.name,email:p.email,permissions:p.permissions||[],mustChangePassword:p.must_change_password===true,coachingActive:p.permissions?.includes('clara_program')===true}});
 const startSession=async p=>{const id=crypto.randomUUID(),refresh=crypto.randomBytes(48).toString('base64url');await query('mobile_sessions',{method:'POST',body:JSON.stringify({id,profile_id:p.id,refresh_hash:hash(refresh)})});return sessionResult(p,id,refresh);};
 try{
  if(action==='mobile-schema'&&request.method==='GET')return response.json({intake:INTAKE_QUESTIONS,privacyVersion:'2026-09-25',privacyUrl:'https://findedeinding.vercel.app/datenschutz',minimumAge:18});
  if(action==='mobile-register-start'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   const email=clean(b.email,254).toLowerCase(),name=clean(b.name,120);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name||b.privacyAccepted!==true||b.adultConfirmed!==true)throw fail('Name, E-Mail, Volljährigkeit und Datenschutzhinweise bitte prüfen.');
   const intake=normalizeIntake(b.intakeAnswers),mail=stratoMailConfig();if(!mail)throw fail('Der E-Mail-Zugang ist noch nicht verfügbar.',503);
   const id=crypto.randomUUID(),code=String(crypto.randomInt(100000,1000000)),ip=String(request.headers?.['x-vercel-forwarded-for']||request.headers?.['x-forwarded-for']||request.socket?.remoteAddress||'unknown').split(',')[0];
   const allowed=await query('rpc/mobile_registration_start',{method:'POST',body:JSON.stringify({p_id:id,p_email:email,p_name:name,p_phone:clean(b.phone,40),p_intake:intake,p_code:hash(id+':'+code),p_ip:hash(ip)})});if(!allowed)throw fail('Zu viele Anfragen. Bitte später erneut versuchen.',429);
   const transport=nodemailer.createTransport({host:'smtp.strato.de',port:465,secure:true,auth:mail,connectionTimeout:10000,socketTimeout:15000});
   try{await transport.sendMail({from:{name:'Finde dein Ding',address:mail.user},to:email,subject:'Dein Zugang zur Finde-dein-Ding-App',text:`Dein Bestätigungscode: ${code}\nGib diesen Code in der App ein. Er gilt 15 Minuten.\nFalls du diese Registrierung nicht gestartet hast, ignoriere die Nachricht.`,html:renderBrandedEmail({subject:'Dein App-Zugang',body:`Dein Bestätigungscode: ${code}\n\nGib diesen Code in der Finde-dein-Ding-App ein. Er gilt 15 Minuten.\nWenn du keine Registrierung gestartet hast, ignoriere diese Nachricht.`}).html});}finally{transport.close();}
   return response.json({registrationId:id,message:'Dein Bestätigungscode wurde per E-Mail versendet.'});
  }
  if(action==='mobile-register-complete'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   if(!uuid(b.registrationId)||!/^\d{6}$/.test(b.code||'')||typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw fail('Bitte Code und ein Passwort mit 12 bis 128 Zeichen eingeben.');
   const registration=await query('rpc/mobile_registration_claim',{method:'POST',body:JSON.stringify({p_id:b.registrationId,p_code:hash(b.registrationId+':'+b.code),p_purpose:'register'})});if(registration.error)throw fail(registration.error);
   if(registration.state==='complete')throw fail('Registrierung bereits abgeschlossen. Bitte anmelden.',409);
   const existing=await query(`user_profiles?email=eq.${encodeURIComponent(registration.email)}&select=id`);if(existing.length)throw fail('Bitte melde dich mit deinem bestehenden Zugang an oder nutze „Passwort vergessen“.',409);
   let authId=registration.auth_user_id;
   if(!authId){const auth=await fetch(`${config.url}/auth/v1/admin/users`,{method:'POST',headers,body:JSON.stringify({email:registration.email,password:b.password,email_confirm:true,user_metadata:{name:registration.name,mobile_registration_id:registration.id}})});const value=await auth.json();if(!auth.ok)throw fail('Das Konto konnte nicht angelegt werden. Nutze bei einem vorhandenen Konto die Anmeldung.',409);authId=value.id;await query(`mobile_registrations?id=eq.${registration.id}`,{method:'PATCH',body:JSON.stringify({auth_user_id:authId})});}
   if(registration.auth_user_id){const updated=await fetch(`${config.url}/auth/v1/admin/users/${authId}`,{method:'PUT',headers,body:JSON.stringify({password:b.password})});if(!updated.ok)throw fail('Passwort konnte nicht gespeichert werden.',503);}
   const id=await query('rpc/mobile_registration_finish',{method:'POST',body:JSON.stringify({p_id:registration.id,p_auth:authId})});const profile=await profileById(config,id);return response.status(201).json(await startSession(profile));
  }
  if(action==='mobile-reset-start'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   const email=clean(b.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Bitte eine gültige E-Mail-Adresse eingeben.');
   const mail=stratoMailConfig();if(!mail)throw fail('Der E-Mail-Zugang ist noch nicht verfügbar.',503);
   const id=crypto.randomUUID(),code=String(crypto.randomInt(100000,1000000)),ip=String(request.headers?.['x-vercel-forwarded-for']||request.socket?.remoteAddress||'unknown').split(',')[0];
   const allowed=await query('rpc/mobile_registration_start',{method:'POST',body:JSON.stringify({p_id:id,p_email:email,p_name:'Passwort zurücksetzen',p_phone:'',p_intake:{},p_code:hash(id+':'+code),p_ip:hash(ip),p_purpose:'reset'})});if(!allowed)throw fail('Zu viele Anfragen. Bitte später erneut versuchen.',429);
   const profiles=await query(`user_profiles?email=eq.${encodeURIComponent(email)}&role=eq.user&status=eq.active&select=id,auth_user_id`);
   if(profiles[0]?.auth_user_id){const transport=nodemailer.createTransport({host:'smtp.strato.de',port:465,secure:true,auth:mail,connectionTimeout:10000,socketTimeout:15000});try{const rendered=renderBrandedEmail({subject:'Dein neues App-Passwort',body:`Dein Bestätigungscode: ${code}\n\nGib diesen Code innerhalb von 15 Minuten in der App ein, um dein Passwort zurückzusetzen. Wenn du diese Anfrage nicht gestartet hast, ignoriere sie. Dein Passwort bleibt unverändert.`});await transport.sendMail({from:{name:'Finde dein Ding',address:mail.user},to:email,subject:'Passwort zurücksetzen · Finde dein Ding',...rendered});}finally{transport.close();}}
   return response.json({registrationId:id,message:'Wenn ein passendes Konto besteht, wurde ein Code versendet.'});
  }
  if(action==='mobile-reset-complete'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   if(!uuid(b.registrationId)||!/^\d{6}$/.test(b.code||'')||typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw fail('Bitte Code und ein Passwort mit 12 bis 128 Zeichen eingeben.');
   const registration=await query('rpc/mobile_registration_claim',{method:'POST',body:JSON.stringify({p_id:b.registrationId,p_code:hash(b.registrationId+':'+b.code),p_purpose:'reset'})});if(registration.error)throw fail(registration.error);
   const profiles=await query(`user_profiles?email=eq.${encodeURIComponent(registration.email)}&role=eq.user&status=eq.active&select=id,auth_user_id`),p=profiles[0];if(!p?.auth_user_id)throw fail('Der Code ist ungültig oder abgelaufen.');
   const updated=await fetch(`${config.url}/auth/v1/admin/users/${p.auth_user_id}`,{method:'PUT',headers,body:JSON.stringify({password:b.password})});if(!updated.ok)throw fail('Passwort konnte nicht geändert werden.',503);
   await query(`user_profiles?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({must_change_password:false,password_changed_at:new Date().toISOString()})});
   await query(`mobile_sessions?profile_id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({revoked_at:new Date().toISOString()})});
   await query(`mobile_registrations?id=eq.${registration.id}`,{method:'PATCH',body:JSON.stringify({state:'complete'})});
   return response.json({ok:true});
  }
  if(action==='mobile-login'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   const p=await authenticateUser(b.identifier,b.password);if(p.role!=='user')throw fail('Die App ist für Kundenkonten bestimmt.',403);return response.json(await startSession(p));
  }
  if(action==='mobile-refresh'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);if(typeof b.refreshToken!=='string'||b.refreshToken.length<32)throw fail('Bitte erneut anmelden.',401);
   const refresh=crypto.randomBytes(48).toString('base64url'),rotated=await query('rpc/mobile_rotate_session',{method:'POST',body:JSON.stringify({p_old:hash(b.refreshToken),p_new:hash(refresh)})});if(!rotated)throw fail('Bitte erneut anmelden.',401);
   const p=await profileById(config,rotated.profileId);return response.json(sessionResult(p,rotated.id,refresh));
  }
  if(action==='mobile-delete-status'){
   if(request.method!=='POST'||!uuid(b.requestId)||b.receipt!==hash('delete:'+b.requestId))throw fail('Ungültiger Löschbeleg.',403);
   const job=(await query(`customer_deletion_jobs?id=eq.${b.requestId}`))[0];if(!job)throw fail('Löschauftrag nicht gefunden.',404);const done=await completeCustomerDeletion(config,job,query).catch(()=>false);return response.json({complete:done});
  }
  const session=sessionFromRequest(request);if(!session?.profileId||session.role!=='user'||session.adminPreview||!await activeMobileSession(config,session))throw fail('Bitte erneut anmelden.',401);
  const p=await profileById(config,session.profileId);if(!p||p.status!=='active'||p.role!=='user')throw fail('Bitte erneut anmelden.',401);
  if(action==='mobile-contract'&&request.method==='GET'){
   if(p.must_change_password)throw fail('Bitte zuerst dein Startpasswort ändern.',428);
   if(!uuid(request.query.id))throw fail('Gültiger Vertrag fehlt.');
   const contract=(await query(`lead_contracts?id=eq.${request.query.id}&select=id,lead_id,title,document_storage_path,video_recording_bucket,video_recording_path`))[0];
   if(!contract)throw fail('Vertrag nicht gefunden.',404);
   const leads=await query(`leads?id=eq.${contract.lead_id}&converted_user_profile_id=eq.${p.id}&select=id`);
   const source=await query(`user_profiles?id=eq.${p.id}&source_lead_id=eq.${contract.lead_id}&select=id`);
   if(!leads.length&&!source.length)throw fail('Vertrag nicht gefunden.',404);
   const video=request.query.video==='1',bucket=video?contract.video_recording_bucket:'participant-documents',path=video?contract.video_recording_path:contract.document_storage_path;
   if(!['participant-documents','contract-recordings'].includes(bucket)||!path||path.startsWith('/')||path.split('/').includes('..'))throw fail('Für diesen Vertrag ist keine Datei verfügbar.',404);
   const signed=await fetch(`${config.url}/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers,body:JSON.stringify({expiresIn:3600})});const value=await signed.json();if(!signed.ok||!value.signedURL)throw fail('Datei konnte nicht bereitgestellt werden.',503);
   const url=new URL(value.signedURL,config.url+'/storage/v1/').href;
   if(video)return response.json({url});return response.redirect(302,url);
  }
  if(action==='mobile-questions'&&request.method==='GET')return response.json({questions:await query(`customer_questions?user_profile_id=eq.${p.id}&select=id,week,question,answer,status,created_at&order=created_at.desc`)});
  if(action==='mobile-profile'&&request.method==='PATCH'){
   if(p.must_change_password)throw fail('Bitte zuerst dein Startpasswort ändern.',428);
   const update={};for(const [key,length] of Object.entries({name:160,mobile_phone:40,street:240,postal_code:20,city:120,country:120}))if(Object.hasOwn(b,key))update[key]=clean(b[key],length);
   if(!update.name)throw fail('Bitte deinen Namen angeben.');
   await query(`user_profiles?id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify(update)});return response.json({ok:true});
  }
  if(action==='mobile-account'&&request.method==='GET')return response.json({user:{id:p.id,name:p.name,email:p.email,permissions:p.permissions,coachingActive:p.permissions?.includes('clara_program')===true,mustChangePassword:p.must_change_password===true}});
  if(action==='mobile-logout'&&request.method==='POST'){if(session.mobileSessionId)await query(`mobile_sessions?id=eq.${session.mobileSessionId}&profile_id=eq.${p.id}`,{method:'PATCH',body:JSON.stringify({revoked_at:new Date().toISOString()})});return response.json({ok:true});}
  if(action==='mobile-delete'&&request.method==='POST'){
   if(b.confirmed!==true||!uuid(b.requestId))throw fail('Bitte die endgültige Kontolöschung bestätigen.');
   const verified=await authenticateUser(p.email,b.password);if(verified.id!==p.id)throw fail('Bestätigung fehlgeschlagen.',403);
   const result=await query('rpc/mobile_delete_account',{method:'POST',body:JSON.stringify({p_customer:p.id,p_request:b.requestId,p_confirmed:true})});const job=(await query(`customer_deletion_jobs?id=eq.${result.id}`))[0];const complete=await completeCustomerDeletion(config,job,query).catch(()=>false);return response.status(complete?200:202).json({deleted:true,complete,requestId:result.id,receipt:hash('delete:'+result.id),retention:result.retention});
  }
  throw fail('App-Aktion nicht gefunden.',404);
 }catch(error){return response.status(error.status||500).json({error:error.status?error.message:'Der App-Vorgang konnte nicht abgeschlossen werden. Bitte erneut versuchen.'});}
}
