import test from 'node:test';
import assert from 'node:assert/strict';
import {INTAKE_QUESTIONS, normalizeIntake} from '../lib/intake.js';
test('intake preserves exact answers and stable segments, optional barrier may be skipped',()=>{
 const input=Object.fromEntries(INTAKE_QUESTIONS.slice(0,5).map(q=>[q.id,0]));
 const result=normalizeIntake(input);
 assert.equal(result.answers.length,6);assert.equal(result.answers[5].answer,null);
 assert.equal(result.answers[1].segment,'main_concern_1');
 assert.equal(result.answers[0].answer,'Eigentlich ganz okay, aber da geht mehr');
});
test('intake rejects missing required answers and forged options',()=>{
 assert.throws(()=>normalizeIntake({}),/Wie fühlt/);
 const input=Object.fromEntries(INTAKE_QUESTIONS.map(q=>[q.id,0]));
 input.future=99;assert.throws(()=>normalizeIntake(input),/12 Monaten/);
});
