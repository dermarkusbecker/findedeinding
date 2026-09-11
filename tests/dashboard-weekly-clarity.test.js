import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardClarity} from '../lib/dashboard-clarity.js';
import {checkIntegrationHealth,applyIntegrationHealth} from '../lib/integration-health.js';
import {buildSystemRegistry} from '../lib/system-registry.js';
const entry=(week,score,created_at='2026-09-11',completed=true)=>({user_profile_id:'a',week,created_at,structured_data:{['week_'+week]:{[week===1?'clarity_baseline':'clarity_checkin']:{score,completed}}}});
test('dashboard uses latest saved weekly check-ins and excludes locked, reset and invalid values',()=>{
 const access=new Map([['a',{automaticUnlockedWeeks:[1,2,3]}]]);
 assert.equal(dashboardClarity([entry(1,3),entry(2,6),entry(2,4,'2026-09-10'),entry(4,10)],access).averageGain,3);
 assert.equal(dashboardClarity([entry(1,3),entry(2,6,'2026-09-10'),entry(2,null,'2026-09-11',false)],access).averageGain,null);
 assert.equal(dashboardClarity([entry(1,3),entry(2,0)],access).completedComparisons,0);
 assert.equal(dashboardClarity([entry(1,7),entry(2,5)],access).averageGain,-2);
});
test('integration checks make read-only requests and report failed authentication without exposing secrets',async()=>{
 const urls=[];
 const checks=await checkIntegrationHealth({service:{url:'https://db.test',key:'private'},openaiKey:'private',openaiModel:'model'},async(url,options)=>{urls.push(url);assert.equal(options.method,undefined);return new Response(null,{status:url.includes('openai')?401:200});});
 const registry=applyIntegrationHealth(buildSystemRegistry({openaiConfigured:true}),checks);
 assert.equal(urls.length,3);assert.equal(registry.integrations.find(item=>item.id==='openai').status.key,'missing');
 assert.match(registry.integrations.find(item=>item.id==='supabase_auth_mail').detail,/nicht getestet/);
 assert.doesNotMatch(JSON.stringify(checks),/private/);
 assert.equal(registry.summary.activeAgents,0);
});
