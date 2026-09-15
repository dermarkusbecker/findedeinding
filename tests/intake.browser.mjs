import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='preview.test')return r.abort();if(u.pathname==='/api/leads'){
 if(r.request().method()==='POST'){requests.push(r.request().postDataJSON());return r.fulfill({json:u.searchParams.get('action')==='public-intake'?{intakeToken:'receipt'}:{appointment:{startsAt:'2026-10-01T10:00:00Z',calendarConnected:false}}});}
 return r.fulfill({json:{slots:[{date:'2026-10-01',start:'2026-10-01T10:00:00Z',time:'12:00'}],bookingHorizonDays:60}});
 }try{const file=path.join(process.cwd(),u.pathname==='/'?'index.html':u.pathname);return r.fulfill({body:await readFile(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return r.fulfill({status:404,body:''});}});
 await page.goto('https://preview.test/#start');await page.locator('#intakeQuestion h3').waitFor();await page.locator('body.site-loading').waitFor({state:'hidden'});await page.screenshot({path:`/tmp/intake-${width}.png`});
 for(let i=0;i<5;i++){assert.equal(await page.locator('#intakeNext').isDisabled(),true);await page.locator('[data-intake-answer="0"]').click();await page.locator('#intakeNext').click();}
 assert.match(await page.locator('#intakeNext').innerText(),/Überspringen/);await page.locator('#intakeBack').click();assert.equal(await page.locator('#intakeQuestion [aria-pressed=true]').count(),1);await page.locator('#intakeNext').click();await page.locator('#intakeNext').click();
 await page.locator('#leadForm [name=name]').fill('Intake Test');await page.locator('#leadForm [name=email]').fill('intake@example.test');await page.locator('#leadForm [name=consent]').check();await page.locator('[data-public-lead-next]').click();await page.locator('[data-public-slot]').click();
 assert.equal(requests.length,1);assert.equal(requests[0].intakeAnswers.main_concern,0);
 await page.locator('#leadForm [type=submit]').click();await page.locator('#publicBookingSuccess').waitFor({state:'visible'});assert.equal(requests[1].intakeToken,'receipt');assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.querySelector('#leadDialog').scrollWidth>document.querySelector('#leadDialog').clientWidth+1),false);
 await page.close();
}
await browser.close();console.log('PASS intake desktop/mobile: required, back, optional skip, capture before booking, receipt reuse');
