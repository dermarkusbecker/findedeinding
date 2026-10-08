import test from 'node:test';import assert from 'node:assert/strict';
import {handleCustomerContracts} from '../lib/customer-contracts.js';import {customerData,customerVisibleContracts,customerContractDocument} from '../lib/customer-records-service.js';
const service={url:'https://db.example',key:'test'},customer='00000000-0000-4000-8000-000000000001',lead='00000000-0000-4000-8000-000000000002',tariff='00000000-0000-4000-8000-000000000003';
const body={tariffId:tariff,requestKey:'00000000-0000-4000-8000-000000000004',expectedGross:119,serviceStart:'2026-09-21',confirmed:true,signedPdfConfirmed:true,signedDocument:{fileName:'unterschrieben.pdf',mimeType:'application/pdf',contentBase64:Buffer.from('%PDF-1.7 signed fixture').toString('base64')}};
const response=()=>({code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
test('Kundenportal zeigt nur abgeschlossene Verträge und öffnet keine fremden oder internen PDFs',()=>{
 const signed={id:customer,status:'signed',title:'Begleitung',contract_number:'FDD-V-1',document_bucket:'participant-documents',document_storage_path:'kunde/vertrag.pdf',signing_token_hash:'geheim',contract_data:{internalNote:'intern'}};
 const cancelled={...signed,id:lead,status:'cancelled',contract_number:'FDD-V-2'};
 const draft={...signed,id:tariff,status:'draft'};
 const visible=customerVisibleContracts([signed,cancelled,draft]);
 assert.deepEqual(visible.map(item=>item.status),['signed','cancelled']);
 assert.equal(visible[0].hasDocument,true);
 assert.equal(visible[0].document_storage_path,undefined);
 assert.equal(visible[0].signing_token_hash,undefined);
 assert.equal(visible[0].contract_data,undefined);
 assert.equal(customerContractDocument([signed],customer),signed);
 assert.throws(()=>customerContractDocument([draft],tariff),error=>error.status===404);
 assert.throws(()=>customerContractDocument([signed],lead),error=>error.status===404);
});
test('manual contract capture rejects portal users, unconfirmed completion and impossible dates',async()=>{
 await assert.rejects(()=>handleCustomerContracts(service,{admin:false},{method:'POST',body},response()),e=>e.status===403);
 for(const patch of [{confirmed:false},{serviceStart:'2026-02-31'},{requestKey:''}])await assert.rejects(()=>handleCustomerContracts(service,{admin:true,participantId:customer},{method:'POST',body:{...body,...patch}},response()),e=>e.status===400);
});
test('manual capture uses atomic invoice RPC and reports archive failure without losing the saved contract',async()=>{
 const original=global.fetch;let rpc=0;global.fetch=async(url,options)=>{const path=String(url);if(path.endsWith('rpc/create_customer_contract')){rpc++;const data=JSON.parse(options.body);assert.equal(data.p_customer,customer);assert.equal(data.p_tariff,tariff);assert.equal(data.p_request,body.requestKey);return Response.json({contract_id:'contract',lead_id:lead,invoice_number:'FDD-RE-2026-1'});}if(path.includes('lead_contracts?id=eq.contract'))return Response.json([{id:'contract',lead_id:lead}]);if(path.includes('/storage/v1/bucket/participant-documents'))return Response.json({id:'participant-documents'});if(path.includes('/storage/v1/object/participant-documents/'))return Response.json({Key:'saved'});if(path.endsWith('rpc/finance_issue_ready'))return Response.json({},{status:503});if(path.includes('/rest/v1/leads?'))return Response.json([]);throw new Error(path);};
 try{const res=response();await handleCustomerContracts(service,{admin:true,participantId:customer},{method:'POST',body},res);assert.equal(res.code,201);assert.equal(res.body.archivePending,true);assert.equal(res.body.invoice_number,'FDD-RE-2026-1');assert.equal(rpc,1);}finally{global.fetch=original;}
});
test('customer contract draft stores tariff snapshot without invoice or email',async()=>{
 const original=global.fetch,seen=[];
 global.fetch=async(url,options={})=>{const path=String(url);seen.push(path);if(path.includes('lead_contracts?manual_request_id='))return Response.json([]);if(path.includes('user_profiles?'))return Response.json([{id:customer,name:'Alex',email:'alex@example.test',source_lead_id:lead}]);if(path.includes('leads?'))return Response.json([{id:lead,converted_user_profile_id:customer}]);if(path.includes('service_tariffs?'))return Response.json([{id:tariff,name:'Paket',product_label:'Programm',gross_price:119,duration_label:'8 Wochen',payment_model:'Einmalzahlung',payment_due:'Sofort'}]);if(path.endsWith('/lead_contracts')){const data=JSON.parse(options.body);assert.equal(data.status,'draft');assert.equal(data.contract_data.duration,'8 Wochen');return Response.json([{id:'draft-contract'}]);}throw new Error(path);};
 try{const res=response();await handleCustomerContracts(service,{admin:true,participantId:customer},{method:'POST',body:{...body,status:'draft',signedDocument:null,confirmed:false}},res);assert.equal(res.code,201);assert.equal(res.body.draft,true);assert.equal(seen.some(path=>path.includes('finance_invoices')||path.includes('rpc/create_customer_contract')),false);}finally{global.fetch=original;}
});
test('manual customer contract accepts confirmed signed PDF without upload and still initiates mail',async()=>{
 const original=global.fetch,seen=[];
 global.fetch=async(url,options={})=>{const path=String(url);seen.push({path,method:options.method||'GET',body:options.body||''});if(path.endsWith('rpc/create_customer_contract'))return Response.json({contract_id:'contract',lead_id:lead,invoice_number:'FDD-RE-2026-1'});if(path.includes('lead_contracts?id=eq.contract')&&!options.method)return Response.json([{id:'contract',contract_data:{tariffName:'Programm'},document_confirmed_at:null}]);if(path.includes('lead_contracts?id=eq.contract')&&options.method==='PATCH')return Response.json([]);if(path.endsWith('rpc/finance_issue_ready'))return Response.json({},{status:503});if(path.includes('/rest/v1/leads?'))return Response.json([]);throw new Error(path);};
 try{const res=response();await handleCustomerContracts(service,{admin:true,participantId:customer},{method:'POST',body:{...body,signedDocument:null}},res);assert.equal(res.code,201);assert.equal(res.body.invoice_number,'FDD-RE-2026-1');assert.equal(seen.some(item=>item.path.includes('/storage/v1/')),false);const saved=seen.find(item=>item.path.includes('lead_contracts?id=eq.contract')&&item.method==='PATCH');assert.equal(JSON.parse(saved.body).contract_data.manualSignedPdfConfirmed,true);assert.equal(seen.some(item=>item.path.includes('/rest/v1/leads?')),true);}finally{global.fetch=original;}
});
test('customer dashboard distinguishes net account balance, invoice OPOS and unallocated credit',async()=>{
 const original=global.fetch;global.fetch=async url=>{const u=new URL(url),table=u.pathname.split('/').pop();if(table==='user_profiles')return Response.json([{id:customer,source_lead_id:lead}]);if(table==='leads'){assert.ok(u.searchParams.get('or').includes('converted_user_profile_id.eq.'+customer));return Response.json([{id:lead}]);}if(['lead_contracts','lead_payments','finance_invoices'].includes(table))assert.equal(u.searchParams.get('lead_id'),`in.(${lead})`);if(table==='lead_contracts')return Response.json([{id:'contract',status:'signed',amount:119}]);if(table==='lead_payments')return Response.json([{id:'assigned',status:'booked',invoice_id:'invoice',amount:19,booked_at:'2020-01-01'},{id:'unassigned',status:'booked',amount:50,booked_at:'2020-01-01'}]);if(table==='finance_invoices')return Response.json([{id:'invoice',contract_id:'contract',status:'issued',gross:119,invoice_date:'2020-01-01',due_date:'2020-01-01',invoice_number:'RE-1'}]);return Response.json([]);};
 try{const data=await customerData(service,customer);assert.equal(data.finance.openBalance,50);assert.equal(data.finance.accountSummary.open,100);assert.equal(data.finance.accountSummary.customerCredit,50);assert.equal(data.finance.paidTotal,69);assert.equal(data.finance.contractTotal,119);assert.equal(data.contracts[0].invoice.number,'RE-1');}finally{global.fetch=original;}
});
