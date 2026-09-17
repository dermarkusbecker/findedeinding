const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
try {
const page=await browser.newPage({viewport:{width:390,height:800}});
page.on('pageerror',e=>console.log('BROWSER ERROR',e.message));
await page.route('http://speech.test/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/api/participant-program'){await new Promise(r=>setTimeout(r,500));return route.fulfill({json:{text:'Hallo Clara'}});}
 if(path==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/portal-speech.css"><form><textarea></textarea><button type="button" id="voice">Spracheingabe</button><button type="submit">Senden</button></form><script type="module">import {startVoiceCapture} from "/portal-speech.js";voice.onclick=()=>startVoiceCapture({button:voice,onTranscript:t=>document.querySelector("textarea").value+=t,onError:e=>window.error=e});</script>'});
 return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/css',body:await readFile(new URL('..'+path,import.meta.url),'utf8')});
});
await page.addInitScript(()=>{
 window.stopped=0;window.audioClosed=0;
 Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{if(window.denied)throw Object.assign(new Error(),{name:'NotAllowedError'});return {getTracks:()=>[{stop:()=>window.stopped++}]};}}});
 window.AudioContext=class {resume(){return Promise.resolve()}close(){window.audioClosed++;return Promise.resolve()}createMediaStreamSource(){return {connect(){}}}createAnalyser(){return {frequencyBinCount:128,getByteTimeDomainData(a){a.fill(150)}}}};
 window.MediaRecorder=class {static isTypeSupported(){return true}constructor(){window.rec=this;this.state='inactive'}start(){this.state='recording';this.onstart()}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['test audio'],{type:'audio/webm'})});this.onstop()}};

});
await page.goto('http://speech.test/');
await page.click('#voice');await page.getByText('Aufnahme läuft',{exact:true}).waitFor();
await page.waitForFunction(()=>[...document.querySelectorAll('.speech-wave i')].some(b=>parseFloat(b.style.height)>10));
assert.equal(await page.locator('[type=submit]').isDisabled(),true);
assert.equal(await page.locator('textarea').inputValue(),'');
await page.click('[data-speech-stop]');await page.getByText('Wird transkribiert …',{exact:true}).waitFor();
await page.waitForFunction(()=>document.querySelector('textarea').value==='Hallo Clara');
assert.equal(await page.locator('[type=submit]').isDisabled(),false);
await page.click('#voice');await page.click('[data-speech-stop]');await page.click('[data-speech-cancel]');
assert.equal(await page.locator('#voice').isDisabled(),false);
assert.equal(await page.locator('textarea').inputValue(),'Hallo Clara');
await page.click('#voice');await page.evaluate(()=>document.querySelector('form').remove());await page.waitForFunction(()=>window.stopped>=3);
await page.reload();await page.evaluate(()=>window.denied=true);await page.click('#voice');await page.waitForFunction(()=>window.error?.includes('erlaube'));
assert.equal(await page.locator('.speech-capture').count(),0);
await page.evaluate(()=>window.denied=false);await page.click('#voice');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
console.log('Speech browser checks passed: real meter, stop/transcribe, no duplicate text, cancel, cleanup, permission, mobile.');
}finally{await browser.close()}
