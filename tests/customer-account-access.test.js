import test from 'node:test';import assert from 'node:assert/strict';
import {handleCustomerAccount} from '../lib/customer-account-api.js';import {handleFinance} from '../lib/finance-api.js';import {createSession} from '../lib/auth.js';
const customer='00000000-0000-4000-8000-000000000001',lead='00000000-0000-4000-8000-000000000002';
const res=()=>({code:200,status(n){this.code=n;return this;},setHeader(){},json(data){this.body=data;return this;}});
test('account reads scope invoices, payments and adjustments to the same customer including unassigned payments',async()=>{
 const paths=[],response=res();await handleCustomerAccount({method:'GET',query:{action:'finance-account',customerId:customer}},response,{today:'2026-09-21',user:{},query:async path=>path.startsWith('user_profiles')?[{id:customer,name:'Kunde',source_lead_id:lead}]:path.startsWith('leads')?[{id:lead}]:[{}],all:async path=>{if(path.startsWith('finance_account_requests')){assert.ok(path.includes(`customer_id=eq.${customer}`));return [];}paths.push(path);assert.ok(path.includes(`lead_id=in.(${lead})`));return path.startsWith('lead_payments')?[{id:'payment',amount:25,status:'booked',booked_at:'2026-09-21'}]:[];}});
 assert.equal(paths.length,3);assert.equal(response.body.account.summary.balance,-25);assert.equal(response.body.account.summary.unallocated,25);
});
test('foreign adjustment IDs cannot be rendered through a customer account',async()=>{
 await assert.rejects(handleCustomerAccount({method:'GET',query:{action:'finance-account-document',customerId:customer,id:'00000000-0000-4000-8000-000000000003'}},res(),{today:'2026-09-21',user:{},query:async path=>path.startsWith('user_profiles')?[{id:customer}]:path.startsWith('leads')?[{id:lead}]:[{}],all:async()=>[]}),/Beleg nicht gefunden/);
});
test('account write forwards only the authenticated actor and retains successful financial booking when PDF storage is unavailable',async()=>{
 const response=res(),calls=[];await handleCustomerAccount({method:'POST',query:{action:'finance-account-book'},body:{customerId:customer,kind:'claim',requestKey:crypto.randomUUID(),actor:'forged',payload:{amount:119,reason:'Begleitung'}}},response,{user:{profile:{id:'real-staff'}},query:async(path,options)=>{calls.push(path);if(path.startsWith('user_profiles'))return[{id:customer}];if(path==='rpc/finance_account_book'){assert.equal(JSON.parse(options.body).p_actor,'real-staff');return{id:lead};}throw new Error('Storage unavailable');}});
 assert.equal(response.body.ok,true);assert.equal(response.body.archivePending,true);assert.ok(calls.includes('rpc/finance_account_book'));
});
test('customer portal sessions and staff without finance cannot mutate customer accounts',async()=>{
 const previous=global.fetch,env={...process.env};Object.assign(process.env,{AUTH_SECRET:'finance-test-secret-'.repeat(3),SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'});
 try{for(const role of ['user','admin']){global.fetch=async url=>{assert.match(String(url),/user_profiles/);return Response.json([{id:customer,status:'active',role,staff_role:'sales',staff_permissions:['sales_calls'],permissions:['customer_portal']}]);};const response=res(),token=createSession('test@example.com',role,{profileId:customer,permissions:['customer_portal']});await handleFinance({method:'POST',headers:{cookie:`fdd_session=${token}`},query:{action:'finance-account-book'},body:{customerId:customer}},response);assert.ok([401,403].includes(response.code));}}finally{global.fetch=previous;process.env=env;}
});
test('drawer exposes the recorded staff name only for actors attached to this customer account',async()=>{
 const actor='00000000-0000-4000-8000-000000000009',response=res();
 await handleCustomerAccount({method:'GET',query:{action:'finance-account',customerId:customer}},response,{today:'2026-09-21',user:{},query:async path=>{if(path.startsWith('user_profiles?id=in.')){assert.equal(path,`user_profiles?id=in.(${actor})&select=id,name`);return[{id:actor,name:'Sachbearbeiterin'}];}if(path.startsWith('user_profiles'))return[{id:customer}];if(path.startsWith('leads'))return[{id:lead}];return[{}];},all:async path=>path.startsWith('finance_account_requests')?[{actor,result:{id:'invoice'}}]:path.startsWith('finance_invoices')?[{id:'invoice',status:'issued',invoice_date:'2026-09-01',due_date:'2026-09-30',gross:119,net:100,vat:19,vat_rate:19,created_at:'2026-09-01T10:00:00Z'}]:[]});
 const entry=response.body.account.entries[0];assert.equal(entry.actorName,'Sachbearbeiterin');assert.equal(entry.net,100);assert.equal(entry.vat,19);assert.equal(entry.vatRate,19);assert.equal(entry.created,'2026-09-01T10:00:00Z');
});
