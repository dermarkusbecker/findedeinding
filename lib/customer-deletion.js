import {authHeaders,requireCurrentAdmin,supabaseAuthConfig} from './user-auth.js';
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const mayDeleteCustomers=admin=>admin?.role==='admin'&&['owner','administrator'].includes(admin.staffRole);
export async function completeCustomerDeletion(config,job,query,{fetcher=fetch,maxMilliseconds=35000}={}){
 if(job.status==='complete')return true;
 const started=Date.now(),headers=authHeaders(config.serviceKey),files=Array.isArray(job.files)?[...job.files]:[];
 const buckets=new Set(['participant-documents','participant-avatars','communication-attachments','contract-recordings','finance-documents']);
 while(files.length){
  if(Date.now()-started>maxMilliseconds)return false;
  const bucket=files[0].bucket,batch=files.filter(f=>f.bucket===bucket).slice(0,100);
  if(!buckets.has(bucket)||batch.some(f=>!f.path||f.path.startsWith('/')||f.path.split('/').includes('..')))throw fail('Ungültige Dateizuordnung. Löschvorgang muss geprüft werden.',409);
  const response=await fetcher(`${config.url}/storage/v1/object/${encodeURIComponent(bucket)}`,{method:'DELETE',headers,body:JSON.stringify({prefixes:batch.map(f=>f.path)}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw fail('Dateien konnten noch nicht vollständig gelöscht werden. Bitte die Bereinigung erneut starten.',503);
  const paths=new Set(batch.map(f=>f.path));for(let n=files.length-1;n>=0;n--)if(files[n].bucket===bucket&&paths.has(files[n].path))files.splice(n,1);
  // Persist progress; repeating an already successful object deletion is safe.
  await query(`customer_deletion_jobs?id=eq.${job.id}&status=eq.pending`,{method:'PATCH',body:JSON.stringify({files})});
 }
 if(job.auth_user_id){
  const response=await fetcher(`${config.url}/auth/v1/admin/users/${encodeURIComponent(job.auth_user_id)}`,{method:'DELETE',headers,signal:AbortSignal.timeout(12000)});
  if(!response.ok&&response.status!==404)throw fail('Der Portalzugang ist gesperrt; die endgültige Kontobereinigung muss erneut gestartet werden.',503);
 }
 await query(`customer_deletion_jobs?id=eq.${job.id}&status=eq.pending`,{method:'PATCH',body:JSON.stringify({status:'complete',completed_at:new Date().toISOString(),files:[],auth_user_id:null,display_name:null,lead_ids:[]})});return true;
}
export async function handleCustomerDeletion(request,response){
 const admin=await requireCurrentAdmin(request,response);
 if(!admin)return;
 if(!mayDeleteCustomers(admin))return response.status(403).json({error:'Nur Systeminhaber und Administration dürfen Kunden löschen.'});
 response.setHeader('Cache-Control','private, no-store');
 if(request.headers?.['sec-fetch-site']==='cross-site')return response.status(403).json({error:'Diese Aktion muss im CRM bestätigt werden.'});
 const config=supabaseAuthConfig(),headers=authHeaders(config.serviceKey);
 const query=async(path,options={})=>{const r=await fetch(`${config.url}/rest/v1/${path}`,{...options,headers:{...headers,Prefer:'return=representation'},signal:AbortSignal.timeout(15000)}),body=await r.json().catch(()=>null);if(!r.ok)throw fail(body?.message||'Löschvorgang konnte nicht gespeichert werden.',r.status);return body;};
 try{
  if(request.method==='GET'){
   if(request.query.pending==='1')return response.json({pending:await query('customer_deletion_jobs?status=eq.pending&select=id,customer_id,display_name,created_at&order=created_at&limit=100')});
   const id=request.query.id;if(!uuid(id))throw fail('Gültige Kunden-ID fehlt.');
   const [customer]=await query(`user_profiles?id=eq.${id}&role=eq.user&select=id,name,email,customer_number`);
   if(!customer)throw fail('Kunde nicht gefunden.',404);
   return response.json({customer});
  }
  if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
  const b=request.body||{};
  if(b.confirmed!==true||!uuid(b.id)||!uuid(b.requestKey)||typeof b.confirmationName!=='string')throw fail('Bitte den Kunden auswählen und die endgültige Löschung mit dem Häkchen bestätigen.');
  const result=await query('rpc/delete_customer_confirmed',{method:'POST',body:JSON.stringify({p_customer:b.id,p_request:b.requestKey,p_actor:admin.profile.id,p_confirmed:true,p_name:b.confirmationName})});
  const [job]=await query(`customer_deletion_jobs?id=eq.${result.id}&select=*`);
  if(!job)throw fail('Löschauftrag konnte nicht geladen werden.',503);
  try{const complete=await completeCustomerDeletion(config,job,query);return response.status(complete?200:202).json({ok:complete,deleted:true,cleanupPending:!complete,jobId:job.id});}
  catch{return response.status(202).json({ok:false,deleted:true,cleanupPending:true,jobId:job.id,message:'Die Kundenakte ist gelöscht und der Portalzugang gesperrt. Dateien oder Anmeldekonto müssen noch bereinigt werden. Bitte „Bereinigung fortsetzen“ wählen.'});}
 }catch(e){return response.status(e.status||500).json({error:e.message});}
}
