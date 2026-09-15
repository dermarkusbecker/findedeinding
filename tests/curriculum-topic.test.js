import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCurriculumTopic} from '../lib/curriculum-runtime.js';
const earlier={id:'wishes',title:'Wünsche',kind:'text'},current={id:'life',title:'Leben',kind:'text'};
const records=[{step_id:'wishes',messages:[{role:'user',content:'Auto'}],summary:'Wünscht sich ein Auto'}];
const route=stepId=>resolveCurriculumTopic({lesson:current,weekDefinition:{steps:[earlier,current]},records,content:'Meinen Wunsch nach einem Auto möchte ich korrigieren.',client:{responses:{create:async()=>({output_text:JSON.stringify({stepId})})}}});
test('chat corrections route to a previously recorded topic',async()=>assert.equal((await route('wishes')).id,'wishes'));
test('routing cannot select an unknown topic',async()=>assert.equal((await route('other-week')).id,'life'));
test('routing cannot reopen an unrecorded topic',async()=>assert.equal((await route('future')).id,'life'));
