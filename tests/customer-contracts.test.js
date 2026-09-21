import test from 'node:test';import assert from 'node:assert/strict';
import {handleCustomerContracts} from '../lib/customer-contracts.js';import {customerData} from '../lib/customer-records-service.js';
const service={url:'https://db.example',key:'test'},customer='00000000-0000-4000-8000-000000000001',lead='00000000-0000-4000-8000-000000000002',tariff='00000000-0000-4000-8000-000000000003';
const body={tariffId:tariff,requestKey:'00000000-0000-4000-8000-000000000004',expectedGross:119,serviceStart:'2026-09-21',confirmed:true};
const response=()=>({code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
test('manual contract capture rejects portal users, unconfirmed completion and impossible dates',async()=>{
 await assert.rejects(()=>handleCustomerContracts(service,{admin:false},{method:'POST',body},response()),e=>e.status===403);
 for(const patch of [{confirmed:false},{serviceStart:'2026-02-31'},{requestKey:''}])await assert.rejects(()=>handleCustomerContracts(service,{admin:true,participantId:customer},{method:'POST',body:{...body,...patch}},response()),e=>e.status===400);
});
test('manual capture uses atomic invoice RPC and reports archive failure without losing the saved contract',async()=>{
 const original=global.fetch;let rpc=0;global.fetch=async(url,options)=>{if(String(url).endsWith('rpc/create_customer_contract')){rpc++;const data=JSON.parse(options.body);assert.equal(data.p_customer,customer);assert.equal(data.p_tariff,tariff);assert.equal(data.p_request,body.requestKey);return Response.json({contract_id:'contract',lead_id:lead,invoice_number:'FDD-RE-2026-1'});}assert.ok(String(url).endsWith('rpc/finance_issue_ready'));return Response.json({},{status:503});};
 try{const res=response();await handleCustomerContracts(service,{admin:true,participantId:customer},{method:'POST',body},res);assert.equal(res.code,201);assert.equal(res.body.archivePending,true);assert.equal(res.body.invoice_number,'FDD-RE-2026-1');assert.equal(rpc,1);}finally{global.fetch=original;}
});
test('customer dashboard balance matches invoice OPOS; unallocated payments do not hide unpaid invoices',async()=>{
 const original=global.fetch;global.fetch=async url=>{const u=new URL(url),table=u.pathname.split('/').pop();if(table==='user_profiles')return Response.json([{id:customer,source_lead_id:lead}]);if(table==='leads'){assert.ok(u.searchParams.get('or').includes('converted_user_profile_id.eq.'+customer));return Response.json([{id:lead}]);}if(['lead_contracts','lead_payments','finance_invoices'].includes(table))assert.equal(u.searchParams.get('lead_id'),`in.(${lead})`);if(table==='lead_contracts')return Response.json([{id:'contract',status:'signed',amount:119}]);if(table==='lead_payments')return Response.json([{status:'booked',invoice_id:'invoice',amount:19,booked_at:'2020-01-01'},{status:'booked',amount:50,booked_at:'2020-01-01'}]);if(table==='finance_invoices')return Response.json([{id:'invoice',contract_id:'contract',status:'issued',gross:119,invoice_number:'RE-1'}]);return Response.json([]);};
 try{const data=await customerData(service,customer);assert.equal(data.finance.openBalance,100);assert.equal(data.finance.paidTotal,69);assert.equal(data.finance.contractTotal,119);assert.equal(data.contracts[0].invoice.number,'RE-1');}finally{global.fetch=original;}
});
