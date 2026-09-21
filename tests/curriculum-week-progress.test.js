import test from 'node:test';
import assert from 'node:assert/strict';
import {curriculumWeekProgress as progress} from '../lib/curriculum-week-progress.js';
const definition={weeks:[{steps:[{id:'a'},{id:'b'}]}]};
test('untouched weeks have no progress',()=>assert.equal(progress(definition,[],1),0));
test('saved conversation shows partial progress',()=>assert.equal(progress(definition,[{week:1,step_id:'a',messages:[{role:'user'}]}],1),25));
test('confirmed lessons count fully; unfinished week never reaches 100',()=>assert.equal(progress(definition,['a','b'].map(step_id=>({week:1,step_id,status:'completed'})),1),99));
test('finalized week is 100 percent',()=>assert.equal(progress(definition,[],1,true),100));
test('other weeks do not contribute',()=>assert.equal(progress(definition,[{week:2,step_id:'a',status:'completed'}],1),0));

test('CRM week summary exposes the same partial progress as the customer portal',async()=>{
 const {curriculumProcessWeeks}=await import('../lib/curriculum-results.js');
 const records=[{week:1,step_id:'a',status:'draft',messages:[{role:'user',content:'Mein Wunsch'}]}];
 const weeks=curriculumProcessWeeks({processVersion:{definition},curriculum:records,serializedAccess:{weekStates:[{week:1,accessible:true}]}});
 assert.equal(weeks[0].progressPercent,25);
 assert.equal(weeks[0].progressPercent,progress(definition,records,1));
});
