import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../admin.js',import.meta.url),'utf8');
const search=script.slice(script.indexOf('function normalizeContactSearch'),script.indexOf('function globalContactMatches'));
const load=script.split('\n').find(line=>line.startsWith('async function loadParticipants()'));

test('real demo account is identified, searchable by Demo and reachable without changing its name',async()=>{
 const nodes=new Map();let profiles=[{id:'existing-demo',name:'Persönlicher Name',is_demo:true,participant_progress:[]},{id:'regular',name:'Normaler Kunde',is_demo:false,participant_progress:[]}];
 const context=vm.createContext({document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},fetch:async()=>({ok:true,json:async()=>({participants:profiles})}),renderParticipants(){},renderParticipantLogins(){},renderGlobalContactSearch(){},customerStatus(){return 'active';},toast(message){throw new Error(message);}});
 vm.runInContext(`let participants=[],leads=[];${search}\n${load}`,context);
 await vm.runInContext('loadParticipants()',context);
 assert.equal(nodes.get('#openDemoCustomer').hidden,false);
 assert.equal(vm.runInContext('participants[0].name',context),'Persönlicher Name');
 assert.equal(vm.runInContext("globalContactRecords().filter(r=>r.searchText.includes('demo')).length",context),1);
 assert.equal(vm.runInContext("globalContactRecords().find(r=>r.typeLabel==='DEMO-Kunde').id",context),'existing-demo');
 assert.match(vm.runInContext('demoCustomerBadge(participants[0])',context),/>DEMO</);
 assert.equal(vm.runInContext('demoCustomerBadge(participants[1])',context),'');
 profiles=profiles.slice(1);await vm.runInContext('loadParticipants()',context);
 assert.equal(nodes.get('#openDemoCustomer').hidden,true);
});

test('pinned demo entry remains accessible independently of customer list filters',()=>{
 const nodes=new Map();const context=vm.createContext({participants:[{id:'demo',isDemo:true,name:'Dominik Seidler',customerNumber:'DEMO-1',processWeek:4}],document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}}});
 const start=script.indexOf('function renderDemoCustomerEntry()');const end=script.indexOf('function renderParticipants()',start);
 vm.runInContext(script.slice(start,end),context);vm.runInContext('renderDemoCustomerEntry()',context);
 assert.equal(nodes.get('#demoCustomerEntry').hidden,false);
 assert.equal(nodes.get('#demoCustomerEntryTitle').textContent,'Dominik Seidler');
 assert.match(nodes.get('#demoCustomerEntryDetail').textContent,/Woche 4/);
 context.participants=[];vm.runInContext('renderDemoCustomerEntry()',context);
 assert.equal(nodes.get('#demoCustomerEntry').hidden,true);
});
