import { playChatSound } from './portal-sounds.js';
let activeCapture=null;
export function stopVoiceCapture(){activeCapture?.cancel();}
export async function startVoiceCapture({button,onTranscript,onError=()=>{}}){
 if(activeCapture?.button===button){activeCapture.stop();return;}
 activeCapture?.cancel();
 const startSound=playChatSound('record-start');
 const Recorder=window.MediaRecorder;
 if(!Recorder||!navigator.mediaDevices?.getUserMedia){onError('Spracheingabe ist in diesem Browser nicht verfügbar. Bitte nutze die Tastatur-Diktierfunktion oder tippe deinen Text.');return;}
 const panel=document.createElement('section');panel.className='speech-capture';panel.setAttribute('aria-label','Spracheingabe');
 panel.innerHTML='<div class="speech-capture-head"><span class="speech-record-dot" aria-hidden="true"></span><strong role="status">Mikrofon wird aktiviert …</strong><time>0:00</time></div><div class="speech-wave" aria-hidden="true">'+Array.from({length:28},()=>'<i></i>').join('')+'</div><p class="speech-capture-hint">Sprich ganz natürlich. Nach dem Stoppen wird die Aufnahme an OpenAI zur Transkription übertragen. Du kannst den Text vor dem Senden prüfen. Maximal 3 Minuten.</p><div class="speech-capture-actions"><button type="button" data-speech-cancel>Verwerfen</button><button type="button" data-speech-stop disabled>■ Stoppen & transkribieren</button></div>';
 button.insertAdjacentElement('afterend',panel);
 const submitStates=[...(button.closest('form')?.querySelectorAll('button[type=submit],button:not([type]),[data-cconfirm]')||[])].filter(el=>el!==button).map(el=>[el,el.disabled]);
 submitStates.forEach(([el])=>el.disabled=true);
 const label=panel.querySelector('[role=status]'),stop=panel.querySelector('[data-speech-stop]'),bars=[...panel.querySelectorAll('.speech-wave i')],initialLabel=button.textContent;
 const uploadController=new AbortController();let chunks=[],byteCount=0;
 let stream,context,recognition,frame,timer,timeout,finished=false,stopping=false,startedAt=0,finalText='',lastText='';
 const releaseMic=()=>{cancelAnimationFrame(frame);clearInterval(timer);stream?.getTracks().forEach(track=>track.stop());context?.close().catch(()=>{});context=null;};
 const finish=(error,cancel=false)=>{if(finished)return;finished=true;uploadController.abort();if(recognition?.state==='recording')recognition.stop();chunks=[];clearTimeout(timeout);observer.disconnect();releaseMic();window.removeEventListener('pagehide',cancelCapture);document.removeEventListener('visibilitychange',onVisibility);button.disabled=false;submitStates.forEach(([el,disabled])=>el.disabled=disabled);button.textContent=initialLabel;button.classList.remove('listening');button.setAttribute('aria-pressed','false');panel.remove();if(activeCapture?.button===button)activeCapture=null;if(error)onError(error);else if(!cancel){const text=(finalText||lastText).trim();if(text)onTranscript(text);else onError('Es wurde keine Sprache erkannt. Bitte versuche es erneut.');}};
 const cancelCapture=()=>{finish(null,true);try{uploadController.abort();}catch{}};
 const onVisibility=()=>{if(document.hidden)cancelCapture();};
 const observer=new MutationObserver(()=>{if(!button.isConnected||button.closest('[hidden],.hidden,.screen:not(.active),dialog:not([open])'))cancelCapture();});
 observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
 const beginTranscription=()=>{if(finished||stopping)return;stopping=true;panel.classList.add('transcribing');label.textContent='Wird transkribiert …';stop.disabled=true;button.disabled=true;timeout=setTimeout(()=>{button.disabled=false;finish('Die Transkription hat zu lange gedauert. Bitte versuche es erneut.');try{uploadController.abort();}catch{}},55000);};
 const stopCapture=()=>{if(stopping||finished)return;if(!startedAt){cancelCapture();return;}beginTranscription();try{recognition?.stop();}catch{button.disabled=false;finish('Die Aufnahme konnte nicht abgeschlossen werden.');}};
 activeCapture={button,stop:stopCapture,cancel:cancelCapture};panel.querySelector('[data-speech-cancel]').onclick=cancelCapture;stop.onclick=stopCapture;
 window.addEventListener('pagehide',cancelCapture);document.addEventListener('visibilitychange',onVisibility);button.setAttribute('aria-pressed','true');button.textContent='Mikrofon wird aktiviert …';
 try{
 stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(finished){stream.getTracks().forEach(t=>t.stop());return;}
 const Audio=window.AudioContext||window.webkitAudioContext;
 if(Audio){context=new Audio();await context.resume();if(finished)return;const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(stream).connect(analyser);const samples=new Uint8Array(analyser.frequencyBinCount);const levels=new Array(bars.length).fill(0);const draw=()=>{if(finished||stopping)return;analyser.getByteTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+((x-128)/128)**2,0)/samples.length);levels.shift();levels.push(Math.min(1,rms*5));bars.forEach((bar,i)=>{bar.style.height=(4+levels[i]*40)+'px';});frame=requestAnimationFrame(draw);};draw();}
 const mimeType=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type=>Recorder.isTypeSupported(type));
 if(!mimeType)throw Error('format');
 recognition=new Recorder(stream,{mimeType,audioBitsPerSecond:64000});
 recognition.onstart=()=>{if(finished)return;startedAt=Date.now();button.textContent='■ Aufnahme stoppen';button.classList.add('listening');label.textContent='Aufnahme läuft';stop.disabled=false;timer=setInterval(()=>{const seconds=Math.floor((Date.now()-startedAt)/1000);panel.querySelector('time').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(seconds>=180)stopCapture();},250);};
 recognition.ondataavailable=event=>{if(finished)return;if(event.data.size){chunks.push(event.data);byteCount+=event.data.size;if(byteCount>2800000)stopCapture();}};
 recognition.onerror=()=>finish('Die Aufnahme wurde unterbrochen. Bitte versuche es erneut.');
 recognition.onstop=async()=>{releaseMic();if(finished)return;void playChatSound('record-stop');beginTranscription();try{
 const blob=new Blob(chunks,{type:mimeType});chunks=[];
 if(!blob.size||blob.size>3000000)throw Error('Die Aufnahme ist leer oder zu groß. Bitte kürzer aufnehmen.');
 const audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Aufnahme konnte nicht gelesen werden.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});
 if(finished)return;
 const response=await fetch('/api/participant-program?feature=speech-transcription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio,mimeType}),signal:uploadController.signal});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Transkription fehlgeschlagen.');
 finalText=data.text||'';finish();
 }catch(error){if(!finished)finish(error.message||'Die Transkription ist fehlgeschlagen.');}};
 await startSound;if(finished)return;
 recognition.start(1000);

 }catch(error){button.disabled=false;finish(error.name==='NotAllowedError'?'Bitte erlaube den Mikrofonzugriff.':'Das Mikrofon konnte nicht gestartet werden. Bitte prüfe die Browserberechtigung.');}
}
