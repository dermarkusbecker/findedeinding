import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {handleMobile,activeMobileSession} from '../lib/mobile-api.js';
import {createSession,sessionFromToken} from '../lib/auth.js';
const customer='00000000-0000-4000-8000-000000000001',sid='00000000-0000-4000-8000-000000000002';
const profile={id:customer,auth_user_id:'00000000-0000-4000-8000-000000000003',name:'Kundin',email:'kunde@example.test',role:'user',status:'active',permissions:['customer_portal','documents']};
const config={url:'https://mobile-test.invalid',serviceKey:'service',anonKey:'anon'};
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}});
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function run(action,{body={},method='POST',token,fetcher,enabled=true,headers={}}={}){
 const env={...process.env},fetch=globalThis.fetch;Object.assign(process.env,{AUTH_SECRET:'mobile-test-secret',SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.anonKey,SUPABASE_SERVICE_ROLE_KEY:config.serviceKey,MOBILE_APP_ENABLED:String(enabled),STRATO_MAILBOX_USER:'mail@example.test',STRATO_MAILBOX_PASSWORD:'test-only'});
 globalThis.fetch=fetcher||(()=>{throw Error('Unexpected network request')});
 const res=response();try{await handleMobile({query:{action},body,method,headers:{...(token?{authorization:`Bearer ${token()}`} : {}),...headers},socket:{remoteAddress:'127.0.0.1'}},res);return res}finally{process.env=env;globalThis.fetch=fetch}
}
const token=()=>createSession(profile.email,'user',{profileId:customer,participantId:customer,mobileSessionId:sid,permissions:profile.permissions});
test('mobile release gate and cross-site requests fail before any network access',async()=>{
 assert.equal((await run('mobile-schema',{method:'GET',enabled:false})).statusCode,503);
 assert.equal((await run('mobile-login',{headers:{'sec-fetch-site':'cross-site'}})).statusCode,403);
 const schema=await run('mobile-schema',{method:'GET'});assert.equal(schema.body.intake.length,6);assert.equal(schema.body.minimumAge,18);
});
test('registration requires intake, deliberate privacy acknowledgment and verified adult status',async()=>{
 for(const body of [{name:'Test',email:'a@example.test'},{name:'Test',email:'a@example.test',privacyAccepted:true,adultConfirmed:true}])assert.equal((await run('mobile-register-start',{body})).statusCode,400);
});
test('registration email includes a real HTML string and stores only a hash of its one-time code',async()=>{
 const original=nodemailer.createTransport;let mail,payload;nodemailer.createTransport=()=>({sendMail:async value=>{mail=value},close(){}});
 try{const r=await run('mobile-register-start',{body:{name:'Test',email:'a@example.test',privacyAccepted:true,adultConfirmed:true,intakeAnswers:{job_feeling:0,main_concern:0,duration:0,inaction:0,future:0}},fetcher:async(url,opts)=>{assert.match(url,/rpc\/mobile_registration_start$/);payload=JSON.parse(opts.body);return reply(true)}});assert.equal(r.statusCode,200);assert.equal(typeof mail.html,'string');assert.match(mail.html,/fdd-logo/);const code=mail.text.match(/\b\d{6}\b/)[0];assert.notEqual(payload.p_code,code);assert.equal(payload.p_code.length,64);assert.notEqual(payload.p_ip,'127.0.0.1');assert.equal('code' in r.body,false)}finally{nodemailer.createTransport=original}
});
test('refresh rotates the credential and issues an own-customer access token only',async()=>{
 const r=await run('mobile-refresh',{body:{refreshToken:'r'.repeat(48),profileId:'attacker'},fetcher:async(url,opts)=>{if(url.includes('/rpc/mobile_rotate_session')){const body=JSON.parse(opts.body);assert.equal(body.p_old.length,64);assert.equal(body.p_new.length,64);return reply({id:sid,profileId:customer})}assert.match(url,new RegExp('user_profiles\\?id=eq.'+customer));return reply([profile])}});
 assert.equal(r.statusCode,200);assert.notEqual(r.body.refreshToken,'r'.repeat(48));const old=process.env.AUTH_SECRET;process.env.AUTH_SECRET='mobile-test-secret';try{const claims=sessionFromToken(r.body.token);assert.equal(claims.profileId,customer);assert.equal(claims.mobileSessionId,sid);assert.deepEqual(claims.permissions,['customer_portal','documents'])}finally{if(old===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=old}
});
test('expired or revoked refresh and access sessions are denied',async()=>{
 assert.equal((await run('mobile-refresh',{body:{refreshToken:'r'.repeat(48)},fetcher:async()=>reply(null)})).statusCode,401);
 assert.equal((await run('mobile-account',{method:'GET',token,fetcher:async()=>reply([])})).statusCode,401);
});
test('profile edits are scoped to the session and cannot grant permissions or change email',async()=>{
 let patch;const r=await run('mobile-profile',{method:'PATCH',token,body:{name:'Neuer Name',profileId:'someone-else',email:'attacker@example.test',permissions:['clara_program'],mobile_phone:'123'},fetcher:async(url,opts)=>{if(url.includes('mobile_sessions'))return reply([{id:sid}]);if(opts.method==='PATCH'){assert.match(url,new RegExp('id=eq.'+customer));patch=JSON.parse(opts.body);return reply([profile])}return reply([profile])}});assert.equal(r.statusCode,200);assert.deepEqual(patch,{name:'Neuer Name',mobile_phone:'123'});
});
test('account deletion requires confirmation and reauthentication, never a caller-supplied customer id',async()=>{
 let mutation=false;const r=await run('mobile-delete',{token,body:{confirmed:false,requestId:sid,password:'wrong',customerId:'other'},fetcher:async(url,opts)=>{if(opts.method==='POST'){mutation=true;return reply({})}return reply(url.includes('mobile_sessions')?[{id:sid}]:[profile])}});assert.equal(r.statusCode,400);assert.equal(mutation,false);
 assert.equal((await run('mobile-delete-status',{body:{requestId:sid,receipt:'forged'}})).statusCode,403);
});
test('unknown account reset responds neutrally without sending a message',async()=>{
 const original=nodemailer.createTransport;nodemailer.createTransport=()=>{throw Error('Must not send for unknown account')};try{const r=await run('mobile-reset-start',{body:{email:'unknown@example.test'},fetcher:async url=>reply(url.includes('/rpc/')?true:[])});assert.equal(r.statusCode,200);assert.ok(r.body.registrationId)}finally{nodemailer.createTransport=original}
});
