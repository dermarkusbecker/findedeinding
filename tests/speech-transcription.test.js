import test from 'node:test';
import assert from 'node:assert/strict';
import {transcribeSpeech,handleSpeechTranscription} from '../lib/speech-transcription.js';
const audio=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(64)]).toString('base64');
test('German transcription uses domain context and returns editable text',async()=>{let sent;const client={audio:{transcriptions:{create:async options=>{sent=options;return {text:'Ich wünsche mir mehr Freiheit.'};}}}};assert.deepEqual(await transcribeSpeech({audio,mimeType:'audio/webm;codecs=opus'},{client}),{text:'Ich wünsche mir mehr Freiheit.'});assert.equal(sent.language,'de');assert.equal(sent.model,'gpt-4o-transcribe');assert.match(sent.prompt,/Clara/);});
test('invalid formats and oversized uploads rejected before provider',async()=>{for(const body of [{audio,mimeType:'text/html'},{audio:'a'.repeat(4000001),mimeType:'audio/webm'},{audio:Buffer.alloc(64).toString('base64'),mimeType:'audio/webm'}])await assert.rejects(transcribeSpeech(body),e=>e.status===400);});
test('preview cannot use paid transcription',async()=>{const response={status(s){this.code=s;return this},json(v){this.body=v}};await handleSpeechTranscription({method:'POST'},response,{adminPreview:true});assert.equal(response.code,403);});
