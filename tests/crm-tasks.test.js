import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTask,buildTaskList,handleCrmTasks} from '../lib/crm-tasks.js';
const id='10000000-0000-4000-8000-000000000001';
test('tasks accept internal or valid linked contacts and reject invalid titles and due dates',()=>{
 assert.equal(normalizeTask({title:'Intern',leadId:null}).lead_id,null);
 assert.equal(normalizeTask({title:'Kontakt',leadId:id,dueAt:'2026-09-12'}).due_at,'2026-09-12');
 for(const dueAt of ['2026-02-30','2026-99-01','invalid'])assert.throws(()=>normalizeTask({title:'X',leadId:null,dueAt}),/gültiges/);
 assert.throws(()=>normalizeTask({title:'',leadId:null}));assert.throws(()=>normalizeTask({title:'X',leadId:'wrong'}));
});
test('manual, automatic and question sources retain the correct customer or lead links',()=>{
 const rows=buildTaskList([{id:'t1',lead_id:'l1',task_type:'clarity_decline'},{id:'t2',lead_id:null}], [{id:'q',user_profile_id:'u',week:2,question:'[Klarheits-Nachgespräch für Markus] Bitte prüfen',status:'open'}],[{id:'l1',name:'Kunde',converted_user_profile_id:'u'}],[{id:'u',name:'Kunde'}]);
 assert.equal(rows.length,3);assert.equal(rows[0].contactId,'u');assert.equal(rows[0].source,'clarity_decline');assert.equal(rows[1].contactId,null);assert.equal(rows[2].kind,'question');assert.equal(rows[2].completed,false);
});
test('task updates reject stale edits and require documentation before resolving customer questions',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});let writes=0;
 global.fetch=async(url,options)=>{if(options.method==='PATCH')writes++;return Response.json([{id,lead_id:null,updated_at:'2026-09-12T00:00:00Z'}]);};
 const response={setHeader(){},status(){return this;},json(value){return value;}};
 const service={url:'https://db.test',key:'test'};
 await assert.rejects(handleCrmTasks({method:'PATCH',body:{id,kind:'task',title:'Test',completed:false,updatedAt:'old'}},response,service),/zwischenzeitlich/);
 await assert.rejects(handleCrmTasks({method:'PATCH',body:{id,kind:'question',completed:true,adminNote:''}},response,service),/dokumentiere/);
 assert.equal(writes,0);
});
