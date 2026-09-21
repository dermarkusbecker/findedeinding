import {loadPaymentPlans} from './installments.js';
import {customerAccount} from './customer-account.js';
const valid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
export async function handlePaymentPlans(request,response,{query,all,user,today}){
 const id=request.query.customerId||request.body?.customerId;
 if(!valid(id))return response.status(400).json({error:'Gültige Kunden-ID fehlt.'});
 const [profile]=await query(`user_profiles?id=eq.${id}&role=eq.user&select=id,source_lead_id`);
 if(!profile)return response.status(404).json({error:'Kunde nicht gefunden.'});
 if(request.method==='POST'){
  const b=request.body||{};if(!valid(b.requestKey)||!['create','replace','cancel'].includes(b.operation)||!b.payload||typeof b.payload!=='object')return response.status(400).json({error:'Ungültiger Ratenplan.'});
  const result=await query('rpc/finance_plan_save',{method:'POST',body:JSON.stringify({p_customer:id,p_action:b.operation,p_payload:b.payload,p_request:b.requestKey,p_actor:user.profile?.id||user.profileId||user.name||'CRM-Administrator'})});return response.json({ok:true,result});
 }
 if(request.method!=='GET')return response.status(405).json({error:'Methode nicht erlaubt.'});
 const leads=await query(`leads?or=(converted_user_profile_id.eq.${id}${profile.source_lead_id?`,and(id.eq.${profile.source_lead_id},converted_user_profile_id.is.null)`:''})&select=id`),scope=`lead_id=in.(${leads.map(l=>l.id).join(',')})`;
 const [invoices,payments,events,plans]=await Promise.all([leads.length?all(`finance_invoices?${scope}&select=*&order=id`):[],leads.length?all(`lead_payments?${scope}&select=*&order=id`):[],leads.length?all(`finance_account_events?${scope}&select=*&order=id`):[],loadPaymentPlans({all,customerId:id})]);
 const account=customerAccount({invoices,payments,events,today,plans});
 const notices=await all(`finance_dunning_notices?customer_id=eq.${id}&select=id,stage,status,amount,sent_at,created_at,target_key,error&order=created_at.desc,id`);
 return response.json({plans,account,notices,today});
}
