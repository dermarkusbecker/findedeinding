import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeVideoContract,buildVideoContractPdf} from '../lib/video-contract.js';
import {PDFDocument} from 'pdf-lib';

test('incomplete PDF drafts preserve intentionally empty inputs without bypassing final validation',async()=>{
 const {contract,missing}=normalizeVideoContract({customerName:'Test',customerEmail:'',street:'Teststraße 4'}, {email:'old@example.test'});
 assert.equal(contract.customerEmail,'');assert.ok(missing.includes('E-Mail'));
 const pdf=await PDFDocument.load(await buildVideoContractPdf(contract,{draft:true}));
 assert.equal(pdf.getPageCount(),7);
});
test('autosave serializes edits, reuses the new contract ID, and retains failed changes for retry',async()=>{
 const source=await readFile(new URL('../admin.js',import.meta.url),'utf8');
 const start=source.indexOf('let videoDraftTimer,');
 const end=source.indexOf("videoContractForm.addEventListener('input'",start);
 const nodes=new Map();let value='first',release;const requests=[];let fail=false;
 const context=vm.createContext({setTimeout:()=>1,clearTimeout:()=>{},Date,encodeURIComponent,
  document:{querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},
  activeLeadDashboard:{lead:{id:'lead'},contracts:[]},videoContractDialog:{open:true},videoContractForm:{elements:{contractId:{value:''}}},latestVideoContract:()=>null,
  videoContractPayload:()=>({customerName:value}),renderSalesContractState:()=>{},contractRecorder:null,updateVideoFinalizeState:()=>{},
  fetch:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(requests.length===1)await new Promise(resolve=>release=resolve);return {ok:!fail,json:async()=>fail?{error:'offline'}:{record:{id:'contract',status:'draft',contract_data:body.contract,updated_at:String(requests.length)},documentUrl:'/api/leads?action=contract-download'}};}
 });
 vm.runInContext(source.slice(start,end),context);
 vm.runInContext('queueVideoContractDraft()',context);
 const first=vm.runInContext('flushVideoContractDraft()',context);
 value='second';vm.runInContext('queueVideoContractDraft()',context);release();await first;
 assert.equal(requests.length,2);assert.equal(requests[1].contractId,'contract');assert.equal(requests[1].contract.customerName,'second');
 fail=true;vm.runInContext('queueVideoContractDraft()',context);await assert.rejects(vm.runInContext('flushVideoContractDraft()',context),/offline/);
 assert.match(nodes.get('#videoContractDocumentState').textContent,/Nicht gespeichert/);
 fail=false;await vm.runInContext('flushVideoContractDraft()',context);
 assert.match(nodes.get('#videoContractDocumentState').textContent,/automatisch/);
});
