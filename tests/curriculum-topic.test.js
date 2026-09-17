import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCurriculumTopic} from '../lib/curriculum-runtime.js';
const earlier={id:'wishes',title:'Wünsche',kind:'text'},current={id:'life',title:'Leben',kind:'text'};
const records=[{step_id:'wishes',messages:[{role:'user',content:'Auto'}],summary:'Wünscht sich ein Auto'}];
const route=stepId=>resolveCurriculumTopic({lesson:current,weekDefinition:{steps:[earlier,current]},records,content:'Meinen Wunsch nach einem Auto möchte ich korrigieren.',client:{responses:{create:async()=>({output_text:JSON.stringify({stepId})})}}});
test('chat corrections route to a previously recorded topic',async()=>assert.equal((await route('wishes')).id,'wishes'));
test('routing cannot select an unknown topic',async()=>assert.equal((await route('other-week')).id,'life'));
test('routing cannot reopen an unrecorded topic',async()=>assert.equal((await route('future')).id,'life'));
test('short replies such as ok include the JSON format instruction in routing input',async()=>{
 let called=false;
 const selected=await resolveCurriculumTopic({lesson:current,weekDefinition:{steps:[earlier,current]},records,content:'ok',client:{responses:{create:async request=>{
  called=true;
  assert.equal(request.text.format.type,'json_object');
  assert.match(request.input,/json/i);
  const input=JSON.parse(request.input);
  assert.equal(input.response_format,'json');
  assert.equal(input.content,'ok');
  return {output_text:JSON.stringify({stepId:'life'})};
 }}}});
 assert.equal(called,true);
 assert.equal(selected.id,'life');
});
