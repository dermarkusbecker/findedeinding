import crypto from 'node:crypto';
// Authentication provider owns the email body and secret recovery link; neither is copied into CRM.
export async function sendLoggedRecovery(config,email,send,{purpose='password_reset'}={}){
 const key=config.serviceKey||config.key,headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'};
 const request=async(path,method='GET',body)=>{const r=await fetch(`${config.url}/rest/v1/${path}`,{method,headers,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error('Systemmail-Protokoll konnte nicht gespeichert werden.');return r.status===204?[]:r.json();};
 const [profile]=await request(`user_profiles?email=eq.${encodeURIComponent(email)}&role=eq.user&select=id,source_lead_id&limit=1`);
 if(!profile)return send();
 const [entry]=await request('lead_communications','POST',{user_profile_id:profile.id,lead_id:profile.source_lead_id||null,direction:'outbound',channel:'email',subject:purpose==='invitation'?'Persönlichen Zugang einrichten':'Passwort zurücksetzen',body:'Systemmail über Supabase Auth angefordert. Inhalt und persönlicher Sicherheitslink werden vom Authentifizierungsdienst erzeugt und nicht im CRM gespeichert.',preview:'Systemmail angefordert; Versandbestätigung steht aus.',delivery_status:'pending',automation_source:'supabase_auth',event_key:crypto.randomUUID()});
 if(!entry?.id)throw new Error('Systemmail-Protokoll konnte nicht angelegt werden.');
 try{await send();}catch(error){await request(`lead_communications?id=eq.${entry.id}`,'PATCH',{delivery_status:'failed',preview:'Der Authentifizierungsdienst hat die Versandanfrage abgelehnt.',updated_at:new Date().toISOString()});throw error;}
 await request(`lead_communications?id=eq.${entry.id}`,'PATCH',{delivery_status:'accepted',preview:'Versandanfrage von Supabase Auth angenommen. Zustellung nicht bestätigt.',updated_at:new Date().toISOString()});
}
