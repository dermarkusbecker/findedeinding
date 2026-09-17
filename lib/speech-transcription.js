import OpenAI, {toFile} from 'openai';
const formats={'audio/webm':'webm','audio/mp4':'mp4','audio/ogg':'ogg'};
export async function transcribeSpeech(body,{client,env=process.env}={}){
 const mime=String(body?.mimeType||'').split(';')[0];
 const encoded=body?.audio;
 if(!formats[mime]||typeof encoded!=='string'||!encoded.length||encoded.length>4000000||! /^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Object.assign(Error('Ungültige oder zu große Aufnahme. Bitte maximal drei Minuten aufnehmen.'),{status:400});
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length>3000000||bytes.length<32)throw Object.assign(Error('Die Aufnahme ist leer oder zu groß.'),{status:400});
 const signature=mime==='audio/webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):mime==='audio/ogg'?bytes.toString('ascii',0,4)==='OggS':bytes.toString('ascii',4,8)==='ftyp';
 if(!signature)throw Object.assign(Error('Das Aufnahmeformat konnte nicht gelesen werden.'),{status:400});
 if(!client&&!env.OPENAI_API_KEY)throw Object.assign(Error('Die Transkription ist noch nicht eingerichtet.'),{status:503});
 const ai=client||new OpenAI({apiKey:env.OPENAI_API_KEY,timeout:45000,maxRetries:0});
 const result=await ai.audio.transcriptions.create({file:await toFile(bytes,`aufnahme.${formats[mime]}`,{type:mime}),model:'gpt-4o-transcribe',language:'de',response_format:'json',prompt:'Deutsch. Gespräch mit Clara im Programm Finde dein Ding von Markus Becker. Begriffe: Klarheit, Reflexion, Motivatoren, Lebenslauf. Gib die gesprochenen Worte mit korrekter Großschreibung und Satzzeichen wieder. Nicht ergänzen, nicht umformulieren.'});
 const text=String(result.text||'').trim();
 if(!text)throw Object.assign(Error('Keine Sprache erkannt. Bitte erneut aufnehmen.'),{status:422});
 return {text};
}
export async function handleSpeechTranscription(request,response,session){
 if(request.method!=='POST')return response.status(405).json({error:'Methode nicht erlaubt.'});
 if(session.adminPreview)return response.status(403).json({error:'In der Vorschau ist keine Aufnahme möglich.'});
 try{return response.status(200).json(await transcribeSpeech(request.body));}
 catch(error){const safe=[400,422,503].includes(error.status);return response.status(safe?error.status:502).json({error:safe?error.message:'Die Transkription ist gerade nicht möglich. Bitte versuche es erneut.'});}
}
