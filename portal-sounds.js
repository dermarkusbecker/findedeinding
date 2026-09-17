// Short, original interface tones; no external audio requests or microphone data.
let context;
export async function playChatSound(kind){
 try{
  if(localStorage.getItem('fdd-chat-sounds')==='off')return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return;
  context ||= new Audio();
  if(context.state==='suspended')await context.resume();
  const notes=kind==='record-start'?[520,780]:kind==='record-stop'?[660,440]:[740,980];
  const now=context.currentTime;
  notes.forEach((frequency,index)=>{
   const oscillator=context.createOscillator(),gain=context.createGain();
   oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,now);
   const start=now+index*.085;
   gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.055,start+.012);gain.gain.exponentialRampToValueAtTime(.001,start+.11);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.13);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  });
  await new Promise(resolve=>setTimeout(resolve,260));
 }catch{/* Sound must never prevent sending or recording. */}
}
