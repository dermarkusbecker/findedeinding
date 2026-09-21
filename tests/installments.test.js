import test from 'node:test';import assert from 'node:assert/strict';
import {distributeInstallments,scheduledInvoiceBalances,loadPaymentPlans} from '../lib/installments.js';
import {customerAccount} from '../lib/customer-account.js';
import {nextDunningStage,validateDunningSettings,dunningMessage,processDunning} from '../lib/dunning.js';
import {cronAuthorized} from '../lib/dunning-api.js';
import {renderBrandedEmail} from '../lib/branded-email.js';
import {handleFinance} from '../lib/finance-api.js';import {createSession} from '../lib/auth.js';
test('monthly schedules preserve the anchor day across February and keep exact cents in final installment',()=>{
 const rows=distributeInstallments(2863,3,'2028-01-31');assert.deepEqual(rows.map(r=>r.amount),[954.33,954.33,954.34]);assert.deepEqual(rows.map(r=>r.dueDate),['2028-01-31','2028-02-29','2028-03-31']);assert.throws(()=>distributeInstallments(.02,3,'2026-01-01'));assert.throws(()=>distributeInstallments(100,3,'2026-02-31'));
});
test('account shows only the due part of planned debt without adding duplicate balance or cash',()=>{
 const invoices=[{id:'i',status:'issued',gross:300,invoice_date:'2026-01-01',due_date:'2026-01-01'}],payments=[{id:'p',invoice_id:'i',amount:50,status:'booked',booked_at:'2026-01-02'}];
 const plans=[{id:'plan',status:'active',rates:[{due_date:'2026-01-01',allocations:[{invoice_id:'i',amount:100,later_amount:200}]},{due_date:'2026-03-01',allocations:[{invoice_id:'i',amount:200,later_amount:0}]}]}];
 const account=customerAccount({invoices,payments,plans,today:'2026-02-01'});assert.equal(account.summary.balance,250);assert.equal(account.summary.due,50);assert.equal(account.summary.future,200);assert.equal(account.summary.overdue,50);assert.equal(account.summary.payments,50);assert.equal(account.entries.length,2);
 assert.equal(scheduledInvoiceBalances([{id:'i',open:250}],[{...plans[0],status:'cancelled'}],'2026-02-01')[0].scheduledDue,undefined);
});
test('dunning waits 14 days after due date, then 14 days after each actual sent notice, and blocks uncertain attempts',()=>{
 const item={target_key:'invoice:a',open:119,due_date:'2026-01-01'},stages=[{days:14},{days:14},{days:14}];
 assert.equal(nextDunningStage(item,[],stages,'2026-01-14'),null);assert.equal(nextDunningStage(item,[],stages,'2026-01-15'),1);
 const history=[{target_key:item.target_key,stage:1,status:'sent',sent_at:'2026-03-01T12:00:00Z'}];assert.equal(nextDunningStage(item,history,stages,'2026-03-14'),null);assert.equal(nextDunningStage(item,history,stages,'2026-03-15'),2);
 assert.equal(nextDunningStage(item,[...history,{target_key:item.target_key,stage:2,status:'unknown'}],stages,'2026-05-01'),null);assert.equal(nextDunningStage({...item,open:0},[],stages,'2026-05-01'),null);
});
test('settings validate all three intervals, required amount/reference placeholders and safe subjects',()=>{
 const valid={enabled:true,stages:Array.from({length:3},()=>({days:14,subject:'Erinnerung {{beleg}}',body:'Hallo {{name}}, bitte zahle {{betrag}} für {{beleg}}. {{bank}}'}))};assert.equal(validateDunningSettings(valid).stages.length,3);
 for(const patch of [{days:0},{days:1.2},{subject:'Header\nInjected'},{body:'Hallo, ohne Referenz und Betrag.'},{body:'{{betrag}} {{beleg}} {{geheimnis}}'}])assert.throws(()=>validateDunningSettings({...valid,stages:[{...valid.stages[0],...patch},...valid.stages.slice(1)]}));
 const message=dunningMessage({reference:'RE-1',due_date:'2026-01-01',open:119},{name:'Alex'},valid.stages[0],{iban:'DE123',issuer_name:'Markus Becker'});assert.match(message.body,/119,00/);assert.match(message.body,/DE123/);assert.match(renderBrandedEmail({...message}).html,/fdd-logo.png/);
});
test('cron requires the full secret and never accepts a user-agent or missing bearer',()=>{assert.equal(cronAuthorized({headers:{}},''),false);assert.equal(cronAuthorized({headers:{authorization:'Bearer wrong'}},'right'),false);assert.equal(cronAuthorized({headers:{authorization:'Bearer right'}},'right'),true);});
function workerFixture({gate=true,error=null,finishFailure=false}={}){
 const calls=[],item={target_key:'rate:1',customer_id:'customer',reference:'RE-1 · Rate 1',open:100,due_date:'2026-01-01'};
 const query=async(path,options)=>{calls.push({path,body:options?.body?JSON.parse(options.body):null});if(path.startsWith('finance_dunning_settings'))return[{enabled:true,stages:[1,2,3].map(()=>({days:14,subject:'Erinnerung {{beleg}}',body:'Hallo {{name}}, {{betrag}} für {{beleg}}.'}))}];if(path.startsWith('finance_settings'))return[{iban:'DE123',issuer_name:'Markus'}];if(path.startsWith('user_profiles'))return[{name:'Alex',email:'alex@example.test'}];if(path.endsWith('finance_dunning_claim'))return{id:'notice',communicationId:'message',amount:100};if(path.endsWith('finance_dunning_start'))return gate;if(path.endsWith('finance_dunning_finish')){if(finishFailure)throw new Error('persistence failed');return null;}throw new Error(path);};
 const transport={verify:async()=>{calls.push({path:'verify'});},sendMail:async message=>{calls.push({path:'send',message});if(error)throw error;return{accepted:['alex@example.test']};}};
 return{calls,args:{query,all:async path=>path.startsWith('finance_due_items')?[item]:[],transport,mailbox:'markus@example.test',branding:{brand_name:'Finde dein Ding'},signature:{signer_name:'Markus Becker'},today:'2026-02-01',renderEmail:renderBrandedEmail}};
}
test('worker sends branded mail only after DB gate, logs actual signature and marks SMTP acceptance',async()=>{const f=workerFixture(),result=await processDunning(f.args);assert.equal(result.sent,1);const send=f.calls.find(c=>c.path==='send');assert.match(send.message.html,/Markus Becker/);assert.match(f.calls.find(c=>c.path.endsWith('finance_dunning_claim')).body.p_body,/Markus Becker/);assert.equal(f.calls.at(-1).body.p_status,'sent');assert.ok(f.calls.findIndex(c=>c.path==='send')>f.calls.findIndex(c=>c.path.endsWith('finance_dunning_start')));});
test('payment/change detected at dispatch prevents actual SMTP send',async()=>{const f=workerFixture({gate:false}),result=await processDunning(f.args);assert.equal(result.sent,0);assert.equal(f.calls.some(c=>c.path==='send'),false);});
test('SMTP timeout is uncertain, explicit rejection failed, and persistence failure never triggers a second send',async()=>{
 for(const [error,expected]of[[Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}),'unknown'],[Object.assign(new Error('rejected'),{responseCode:550}),'failed']]){const f=workerFixture({error}),result=await processDunning(f.args);assert.equal(result[expected],1);assert.equal(f.calls.at(-1).body.p_status,expected);}
 const f=workerFixture({finishFailure:true});await assert.rejects(processDunning(f.args),/persistence failed/);assert.equal(f.calls.filter(c=>c.path==='send').length,1);
});
test('plans are customer scoped and unauthorized sessions cannot create plans or edit dunning settings',async()=>{
 await loadPaymentPlans({customerId:'customer-a',all:async path=>{assert.match(path,/customer_id=eq.customer-a/);return[];}});
 const original=global.fetch,env={...process.env};Object.assign(process.env,{AUTH_SECRET:'finance-test-secret-'.repeat(3),SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'});
 try{for(const action of ['finance-plans','finance-dunning-settings','finance-dunning-preview']){global.fetch=async()=>Response.json([{id:'00000000-0000-4000-8000-000000000001',status:'active',role:'user',permissions:['customer_portal']}]);const response={code:200,status(n){this.code=n;return this;},setHeader(){},json(v){this.body=v;return this;}},token=createSession('user@example.test','user',{profileId:'00000000-0000-4000-8000-000000000001',permissions:['customer_portal']});await handleFinance({method:'POST',headers:{cookie:`fdd_session=${token}`},query:{action},body:{}},response);assert.ok([401,403].includes(response.code));}}finally{global.fetch=original;process.env=env;}
});
