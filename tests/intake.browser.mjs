import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
for(const width of [1440,1024,768,390,320]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='preview.test')return r.abort();if(u.pathname==='/api/leads'){
 if(r.request().method()==='POST'){requests.push(r.request().postDataJSON());return r.fulfill({json:u.searchParams.get('action')==='public-intake'?{intakeToken:'receipt'}:{appointment:{startsAt:'2026-10-01T10:00:00Z',calendarConnected:false}}});}
 const month=u.searchParams.get('from').slice(0,7);return r.fulfill({json:{slots:[20,21].flatMap(day=>Array.from({length:24},(_,i)=>({date:month+'-'+day,start:month+'-'+day+'T'+String(8+Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0')+':00Z',time:String(10+Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0')}))),bookingHorizonDays:60,durationMinutes:45}});
 }try{const file=path.join(process.cwd(),u.pathname==='/'?'index.html':u.pathname);return r.fulfill({body:await readFile(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return r.fulfill({status:404,body:''});}});
 async function checkActions(){
 const result=await page.locator('#leadForm .public-lead-step:not([hidden]) .public-lead-actions').evaluate(el=>{const primary=el.querySelector('.button-orange'),back=el.querySelector('.public-lead-back');return {width:primary.getBoundingClientRect().width,available:el.getBoundingClientRect().width,clipped:primary.scrollWidth>primary.clientWidth+1,backBelow:!back||back.hidden||back.getBoundingClientRect().top>=primary.getBoundingClientRect().bottom};});
 assert.ok(result.width>=result.available-2,JSON.stringify({width,...result}));assert.equal(result.clipped,false);assert.equal(result.backBelow,true);
 }
 await page.goto('https://preview.test/#start');await page.locator('#intakeQuestion h3').waitFor();await page.locator('body.site-loading').waitFor({state:'hidden'});await page.screenshot({path:`/tmp/intake-${width}.png`});
 for(let i=0;i<5;i++){assert.equal(await page.locator('#intakeNext').isDisabled(),true);await page.locator('[data-intake-answer="0"]').click();await page.locator('#intakeNext').click();await checkActions();}
 assert.match(await page.locator('#intakeNext').innerText(),/Überspringen/);await page.locator('#intakeBack').click();assert.equal(await page.locator('#intakeQuestion [aria-pressed=true]').count(),1);await page.locator('#intakeNext').click();await page.locator('#intakeNext').click();
 await checkActions();await page.screenshot({path:`/tmp/intake-contact-${width}.png`});
 await page.locator('#leadForm [name=name]').fill('Intake Test');await page.locator('#leadForm [name=email]').fill('intake@example.test');await page.locator('#leadForm [name=consent]').check();await page.locator('[data-public-lead-next]').click();await page.locator('[data-public-slot]').first().click();await checkActions();assert.equal(await page.locator('.booking-calendar-grid').count(),1);assert.equal(await page.locator('[data-calendar-day]').count()>27,true);await page.screenshot({path:`/tmp/booking-calendar-${width}.png`});
 await page.locator('[data-calendar-day]:not([disabled])').last().click();assert.equal(await page.locator('#leadForm [type=submit]').isDisabled(),true);await page.locator('[data-public-slot]').first().click();
 assert.equal(requests.length,1);assert.equal(requests[0].intakeAnswers.main_concern,0);
 await page.locator('#leadForm [type=submit]').click();await page.locator('#publicBookingSuccess').waitFor({state:'visible'});assert.equal(requests[1].intakeToken,'receipt');assert.ok(await page.locator('#publicBookingSuccessText').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=17);await page.screenshot({path:`/tmp/intake-success-${width}.png`});assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.querySelector('#leadDialog').scrollWidth>document.querySelector('#leadDialog').clientWidth+1),false);
 await page.close();
}
await browser.close();console.log('PASS intake desktop/mobile: required, back, optional skip, capture before booking, receipt reuse');
