import {completeCustomerDeletion} from './customer-deletion.js';
// Invoked by the existing authenticated daily cron. Never removes financial archives.
export async function cleanupMobileAccounts(config,query,{deadline=Date.now()+20000}={}) {
 if(process.env.MOBILE_APP_ENABLED!=='true')return {enabled:false};
 const pending=await query('customer_deletion_jobs?status=eq.pending&order=created_at&limit=10');
 let completed=0;
 for(const job of pending){if(Date.now()>deadline)break;try{if(await completeCustomerDeletion(config,job,query,{maxMilliseconds:Math.max(1000,deadline-Date.now())}))completed++;}catch{/* Kept pending for retry; no sensitive payload is logged. */}}
 await query(`mobile_sessions?or=(expires_at.lt.${encodeURIComponent(new Date().toISOString())},revoked_at.not.is.null)`,{method:'DELETE'});
 await query(`mobile_registrations?state=in.(pending,complete)&created_at=lt.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}`,{method:'DELETE'});
 return {enabled:true,completed,pending:pending.length-completed};
}
