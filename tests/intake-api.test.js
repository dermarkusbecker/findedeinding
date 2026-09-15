import test from 'node:test';import assert from 'node:assert/strict';
import handler from '../api/leads.js';import {INTAKE_QUESTIONS} from '../lib/intake.js';
test('public intake persists before booking, reuses signed receipt and rejects tampering',async()=>{
 const old={...process.env},originalFetch=globalThis.fetch;Object.assign(process.env,{SUPABASE_URL:'https://mock.test',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test-secret'});
 const writes=[];globalThis.fetch=async(url,options)=>{writes.push({url,options});return new Response(JSON.stringify([{id:'11111111-1111-4111-8111-111111111111'}]));};
 const body={name:'Test',email:'test@example.test',consent:true,intakeAnswers:Object.fromEntries(INTAKE_QUESTIONS.slice(0,5).map(q=>[q.id,0]))};
 async function call(data){const response={status(n){this.code=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',query:{action:'public-intake'},body:data},response);return response;}
 try{const first=await call(body);assert.equal(first.code,200);assert.equal(writes[0].options.method,'POST');assert.equal(JSON.parse(writes[0].options.body).intake_answers.answers.length,6);
 const second=await call({...body,intakeToken:first.data.intakeToken});assert.equal(second.code,200);assert.equal(writes[1].options.method,'PATCH');
 const invalid=await call({...body,intakeToken:first.data.intakeToken+'x'});assert.equal(invalid.code,400);assert.equal(writes.length,2);
 const noConsent=await call({...body,consent:false});assert.equal(noConsent.code,400);assert.equal(writes.length,2);
 }finally{globalThis.fetch=originalFetch;for(const key of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
