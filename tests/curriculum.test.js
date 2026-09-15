import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProgramDefinition,moveProgramTask} from '../lib/program-builder.js';
import {completedCurriculumWeeks,normalizeSignals,evidenceStrength,respondCurriculum} from '../lib/curriculum-runtime.js';
import {validatedCurriculumInput} from '../lib/curriculum-input.js';
import {curriculumReflection} from '../lib/curriculum-results.js';
const definition=JSON.parse(readFileSync(new URL('../curriculum/fdd-4plus4.json',import.meta.url)));
test('4+4 source contains all 39 lessons, optional model and retained motivator method',()=>{
 assert.deepEqual(validateProgramDefinition(definition),[]);
 assert.equal(definition.weeks.flatMap(w=>w.steps).length,39);
 for(const w of definition.weeks)for(const s of w.steps)for(const key of ['learningGoal','opening','question','adaptiveLogic','storageLogic','evaluation'])assert.ok(s[key],s.id+key);
 assert.ok(definition.weeks[1].steps[4].optional);
 const motivators=definition.modules.find(s=>s.id==='motivators');assert.equal(motivators.kind,'priority_selection');assert.equal(motivators.minItems,5);
 const moved=moveProgramTask(definition,0,0,1,0);assert.equal(moved.weeks[1].steps[0].id,'c44_w1_l1');
});
test('new weeks need their own lessons and explicit finalization; legacy completion is not inherited',()=>{
 const records=definition.weeks[0].steps.map(s=>({week:1,step_id:s.id,status:'completed',summary:s.title,structured_data:{}}));
 assert.deepEqual(completedCurriculumWeeks(definition,records),[]);assert.equal(curriculumReflection(definition,records,1),null);
 records.push({week:1,step_id:'week_complete_1',status:'completed'});
 assert.deepEqual(completedCurriculumWeeks(definition,records),[1]);assert.equal(curriculumReflection(definition,records,1).title,'Standort-Kompass');
 records[0].status='draft';assert.deepEqual(completedCurriculumWeeks(definition,records),[]);
});
test('same source lesson, model outputs and invented source IDs cannot inflate evidence',()=>{
 const sources=[{id:'a',lesson:'one',text:'Original quote',week:1},{id:'b',lesson:'one',text:'Follow-up',week:1},{id:'hd',lesson:'hd',text:'Model',optionalModel:true},{id:'summary',lesson:'summary',text:'Repeat',synthesis:true}];
 const [signal]=normalizeSignals([{signal:'Autonomie',source_ids:['a','b','hd','invented','summary'],original_evidence:'Fabricated quote'}],sources);
 assert.equal(signal.source_ids.length,1);assert.equal(signal.strength,'schwach');assert.ok(!signal.original_evidence.includes('Fabricated'));assert.equal(signal.participant_status,'offen');
 assert.equal(evidenceStrength({source_ids:['a','b','c'],participant_status:'bestätigt'}),'stark');
 assert.equal(evidenceStrength({source_ids:['a','b','c'],participant_status:'widersprochen'}),'schwach');
});
test('retained motivator ranking validates membership, number and uniqueness',()=>{
 const lesson=definition.modules.find(s=>s.id==='motivators');const input=lesson.options.slice(0,5);
 assert.deepEqual(validatedCurriculumInput(lesson,{input}).data.selection,input);
 assert.throws(()=>validatedCurriculumInput(lesson,{input:input.slice(0,4)}));
 assert.throws(()=>validatedCurriculumInput(lesson,{input:[...input.slice(0,4),'made up']}));
 assert.throws(()=>validatedCurriculumInput(lesson,{input:Array(5).fill(input[0])}));
});
test('Clara receives exact adaptive and storage instructions and rejects malformed output',async()=>{
 let request;const client={responses:{create:async r=>{request=r;return {output_text:JSON.stringify({message:'Welche konkrete Situation?',ready:false,summary:'Offen',structured_data:{},signals:[]})};}}};
 const lesson=definition.weeks[0].steps[0];const out=await respondCurriculum({lesson,week:1,records:[],messages:[{role:'user',content:'Mehr Freiheit',source_id:'first'}],sourceId:'first',client});
 assert.equal(out.ready,false);assert.equal(JSON.parse(request.input).lesson.storageLogic,lesson.storageLogic);assert.equal(request.store,false);assert.equal(JSON.parse(request.input).response_format,'json');
 client.responses.create=async()=>({output_text:'not JSON'});await assert.rejects(respondCurriculum({lesson,week:1,records:[],messages:[],client}));
});
import {handleCurriculum} from '../lib/curriculum-api.js';
const participant='00000000-0000-4000-8000-000000000001';
function apiFixture(){return {service:{url:'https://database.test',key:'test'},processVersion:{version:1,definition:structuredClone(definition)},curriculum:[],progress:{privacy_consent_at:'2026-09-01',start_commitment_at:'2026-09-01'},stateEntries:[{week:1,structured_data:{week_1:{clarity_baseline:{score:3}}}}],access:{processWeek:1,status:'active',canAccessWeek:()=>true}};}
async function invoke(body,result=apiFixture(),adminPreview=false){const response={statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};await handleCurriculum({method:'POST',body},response,{participantId:participant,adminPreview},result);return response;}
test('curriculum API enforces onboarding, original clarity check-in, order and read-only preview',async()=>{
 const body={action:'message',week:1,stepId:'c44_w1_l1',content:'Test'};
 assert.equal((await invoke(body,apiFixture(),true)).statusCode,403);
 const paused=apiFixture();paused.access.status='paused';assert.equal((await invoke(body,paused)).statusCode,403);
 const missing=apiFixture();missing.stateEntries=[];assert.equal((await invoke(body,missing)).data.code,'CLARITY_CHECKIN_REQUIRED');
 assert.equal((await invoke({...body,stepId:'c44_w1_l2'})).statusCode,409);
 assert.equal((await invoke({action:'finalize',week:1})).statusCode,409);
 const closed=apiFixture();closed.curriculum=[{week:1,step_id:'week_complete_1',status:'completed'}];assert.equal((await invoke(body,closed)).statusCode,409);
 const external=apiFixture();external.processVersion.definition.weeks[0].steps[0].kind='external';assert.equal((await invoke(body,external)).statusCode,403);
});
import {curriculumAccess} from '../lib/curriculum-progress.js';
import {calculateProgramAccess} from '../lib/program-access.js';
test('CRM progress ignores old completed gates and keeps onboarding closed',()=>{
 const progress={current_week:4,process_status:'WEEK_4',program_start_date:'2026-09-01',privacy_consent_at:'2026-09-01',start_commitment_at:'2026-09-01',program_status:'active'};
 const scheduled=calculateProgramAccess({progress,fullProgramAccess:true});const access=curriculumAccess(scheduled,{definition,records:[]},progress);
 assert.equal(access.processWeek,1);assert.deepEqual(access.completedWeeks,[]);assert.equal(access.weekStates[0].readyToComplete,false);
 const unstarted=calculateProgramAccess({progress:{}});assert.equal(curriculumAccess(unstarted,{definition,records:[]},{}).processWeek,0);
});
