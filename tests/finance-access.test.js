import test from 'node:test';import assert from 'node:assert/strict';import {handleFinance} from '../lib/finance-api.js';import {createSession} from '../lib/auth.js';
test('portal invoice query is scoped to authenticated customer and foreign PDF is denied',async()=>{
 const previous=global.fetch,env={...process.env};Object.assign(process.env,{AUTH_SECRET:'finance-test-secret-'.repeat(3),SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'});
 const id='00000000-0000-0000-0000-000000000001',lead='00000000-0000-0000-0000-000000000002',foreign='00000000-0000-0000-0000-000000000003';let scoped=false;
 global.fetch=async url=>{const s=String(url);if(s.includes('/user_profiles?'))return Response.json([{id,status:'active',role:'user',permissions:['customer_portal']}]);if(s.includes('/leads?')){assert.ok(s.includes('converted_user_profile_id=eq.'+id));return Response.json([{id:lead}]);}if(s.includes('/finance_invoices?')){assert.ok(s.includes('lead_id=in.('+lead+')'));assert.ok(s.includes('id=eq.'+foreign));scoped=true;return Response.json([]);}throw new Error('Unexpected request '+s);};
 const response={status(n){this.code=n;return this;},setHeader(){},json(v){this.body=v;}};
 try{const token=createSession('customer@example.com','user',{profileId:id,permissions:['customer_portal']});await handleFinance({method:'GET',headers:{cookie:`fdd_session=${token}`},query:{action:'finance-my-pdf',id:foreign}},response);assert.equal(response.code,404);assert.ok(scoped);}finally{global.fetch=previous;process.env=env;}
});
test('staff without finance permission cannot read financial register',async()=>{
 const previous=global.fetch,env={...process.env};Object.assign(process.env,{AUTH_SECRET:'finance-test-secret-'.repeat(3),SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'});const id='00000000-0000-0000-0000-000000000001';
 global.fetch=async url=>{assert.match(String(url),/user_profiles/);return Response.json([{id,status:'active',role:'admin',staff_role:'sales',staff_permissions:['sales_calls']}]);};
 const response={status(n){this.code=n;return this;},json(v){this.body=v;}};
 try{const token=createSession('sales@example.com','admin',{profileId:id});await handleFinance({method:'GET',headers:{cookie:`fdd_session=${token}`},query:{action:'finance-list'}},response);assert.equal(response.code,403);}finally{global.fetch=previous;process.env=env;}
});
