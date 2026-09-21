import test from 'node:test';import assert from 'node:assert/strict';
import {mayDeleteCustomers,completeCustomerDeletion,handleCustomerDeletion} from '../lib/customer-deletion.js';import {createSession} from '../lib/auth.js';
const customer='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000010',jobId='00000000-0000-4000-8000-000000000020';
const res=()=>({code:200,status(n){this.code=n;return this;},setHeader(){},json(data){this.body=data;return this;}});
test('deletion is reserved to owner and administrator, not operational staff with broad permissions',()=>{for(const staffRole of ['owner','administrator'])assert.equal(mayDeleteCustomers({role:'admin',staffRole}),true);for(const staffRole of ['sales','finance','customer_success','communications',null])assert.equal(mayDeleteCustomers({role:'admin',staffRole,staffPermissions:['users','customers']}),false);assert.equal(mayDeleteCustomers({role:'user',staffRole:'owner'}),false);});
test('cleanup removes only exact saved paths and auth account, persists progress and scrubs temporary identifiers on completion',async()=>{
 const calls=[],patches=[],job={id:jobId,status:'pending',auth_user_id:'auth-id',files:[{bucket:'participant-documents',path:customer+'/file.pdf'},{bucket:'finance-documents',path:'invoices/invoice.pdf'}]};
 const done=await completeCustomerDeletion({url:'https://db.test',serviceKey:'server'},job,async(p,o)=>patches.push(JSON.parse(o.body)),{fetcher:async(url,options)=>{calls.push({url,options});return new Response('{}',{status:200});}});
 assert.equal(done,true);assert.deepEqual(JSON.parse(calls[0].options.body).prefixes,[customer+'/file.pdf']);assert.match(calls[2].url,/auth\/v1\/admin\/users\/auth-id$/);assert.equal(patches.at(-1).status,'complete');assert.equal(patches.at(-1).auth_user_id,null);assert.deepEqual(patches.at(-1).files,[]);
});
test('failed storage deletion leaves auth and completion untouched; retry accepts already deleted auth user',async()=>{
 const job={id:jobId,status:'pending',auth_user_id:'auth-id',files:[{bucket:'participant-documents',path:customer+'/a.pdf'}]},patches=[];
 await assert.rejects(completeCustomerDeletion({url:'https://db.test',serviceKey:'server'},job,async(p,o)=>patches.push(o),{fetcher:async()=>new Response('{}',{status:503})}),/Dateien/);assert.equal(patches.length,0);
 assert.equal(await completeCustomerDeletion({url:'https://db.test',serviceKey:'server'},{...job,files:[]},async()=>{},{fetcher:async()=>new Response('{}',{status:404})}),true);
});
test('cleanup never deletes a bucket or unsafe path and respects bounded execution',async()=>{
 for(const entry of [{bucket:'global-assets',path:'logo.svg'},{bucket:'participant-documents',path:'../other.pdf'}])await assert.rejects(completeCustomerDeletion({url:'https://db.test'}, {id:jobId,files:[entry]},async()=>{},{fetcher:async()=>assert.fail('must not fetch')}),/Ungültige/);
 assert.equal(await completeCustomerDeletion({}, {id:jobId,files:[{bucket:'participant-documents',path:'x'}]},async()=>{},{maxMilliseconds:-1}),false);
});
test('API checks fresh staff role, literal confirmation and trusted actor before any purge',async()=>{
 const original=global.fetch,env={...process.env};Object.assign(process.env,{AUTH_SECRET:'delete-test-secret-'.repeat(3),SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'});
 const token=createSession('admin@example.test','admin',{profileId:owner}),request={method:'POST',headers:{cookie:`fdd_session=${token}`},query:{action:'delete-customer'},body:{id:customer,requestKey:jobId,confirmationName:'Kunde',confirmed:true,actor:'forged'}};
 try{
  for(const staffRole of ['sales','administrator']){let writes=0;global.fetch=async(url,opts)=>{if(String(url).includes('/user_profiles?'))return Response.json([{id:owner,status:'active',role:'admin',staff_role:staffRole,staff_permissions:['customers']}]);writes++;assert.equal(JSON.parse(opts.body).p_actor,owner);return Response.json({message:'Test stop'},{status:409});};const response=res();await handleCustomerDeletion(request,response);assert.equal(response.code,staffRole==='sales'?403:409);assert.equal(writes,staffRole==='sales'?0:1);}
  global.fetch=async()=>Response.json([{id:owner,status:'active',role:'admin',staff_role:'owner'}]);for(const confirmed of [false,'true',undefined]){const response=res();await handleCustomerDeletion({...request,body:{...request.body,confirmed}},response);assert.equal(response.code,400);}
 }finally{global.fetch=original;process.env=env;}
});
