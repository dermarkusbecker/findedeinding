import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRecordingDraft,
  beginRecording,
  markRecordingStarted,
  prepareRecordingUpload,
  recordingConsents,
  verifyRecordingObject,
  completeRecordingUpload,
} from "../lib/contract-recording-service.js";
import { uploadRecordingChunks } from "../lib/resumable-recording-upload.js";
import {
  ContractRecorder,
  recordingMimeType,
  recordingFileType,
} from "../lib/browser-contract-recorder.js";
test("recording codecs and device file formats are detected without assuming WebM", () => {
  assert.equal(
    recordingMimeType({ isTypeSupported: (type) => type === "video/mp4" }),
    "video/mp4",
  );
  assert.equal(
    recordingMimeType({ isTypeSupported: (type) => type === "video/webm" }),
    "video/webm",
  );
  assert.equal(recordingMimeType({ isTypeSupported: () => false }), "");
  assert.equal(
    recordingFileType({ name: "Aufnahme.MOV", type: "" }),
    "video/quicktime",
  );
  assert.equal(
    recordingFileType({ name: "x.pdf", type: "application/pdf" }),
    "",
  );
});
test("completed contracts and missing consent cannot enter recording workflow", () => {
  assert.throws(() => assertRecordingDraft({ status: "signed" }));
  assert.throws(() =>
    assertRecordingDraft({ status: "draft", video_recording_path: "existing" }),
  );
  assert.doesNotThrow(() => assertRecordingDraft({ status: "draft" }));
  assert.equal(recordingConsents({ recordingConsent: true }), false);
  assert.equal(
    recordingConsents({
      recordingConsent: true,
      recordingPurposeAccepted: true,
      recordingRevocationAccepted: true,
    }),
    true,
  );
});
test('recording consent and screen recording can start from a draft before the PDF is prepared', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes('lead_contract_recording_consents')) return Response.json([{ id: 'audit' }]);
    return Response.json([{ id: 'contract', status: 'draft', video_recording_consent_at: '2026-09-30T12:00:00.000Z', video_recording_consent_record_id: 'audit' }]);
  };
  const service = { url: 'https://example.test', key: 'test' };
  const lead = { id: 'lead' };
  const draft = { id: 'contract', status: 'draft', document_prepared_at: null };
  const actor = { profile: { id: 'staff', name: 'Mitarbeiterin' } };
  const consents = { recordingConsent: true, recordingPurposeAccepted: true, recordingRevocationAccepted: true };
  const accepted = await beginRecording(service, lead, draft, consents, actor);
  assert.equal(accepted.record.video_recording_consent_record_id, 'audit');
  assert.equal(requests[0].body.staff_name, 'Mitarbeiterin');
  assert.ok(requests[0].body.consented_at);
  await markRecordingStarted(service, lead, accepted.record);
  assert.ok(requests.at(-1).body.video_recording_started_at);
});
test('recording upload can be prepared after consent while the contract PDF is still a draft', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith('/storage/v1/bucket/contract-recordings')) return Response.json({ allowed_mime_types: ['video/webm', 'video/mp4', 'video/quicktime', 'audio/webm'] });
    if (target.includes('/storage/v1/object/upload/sign/')) return Response.json({ url: '/object/upload/sign/contract-recordings/lead/video.webm?token=signed' });
    if (options?.method === 'PATCH') return Response.json([{ id: 'contract', status: 'draft', document_prepared_at: null }]);
    throw Error(`Unexpected request: ${target}`);
  };
  const draft = { id: 'contract', status: 'draft', document_prepared_at: null, video_recording_consent_at: '2026-09-30T12:00:00.000Z', video_recording_consent_record_id: 'audit' };
  const upload = await prepareRecordingUpload({ url: 'https://example.test', key: 'test' }, { id: 'lead' }, draft, { fileName: 'video.webm', mimeType: 'video/webm', byteSize: 1024, provider: 'browser_screen', recordingConsent: true, recordingPurposeAccepted: true, recordingRevocationAccepted: true });
  assert.equal(upload.token, 'signed');
  assert.equal(upload.bucket, 'contract-recordings');
});
test('consent control can be used before the first draft exists', () => {
  const recorder = Object.create(ContractRecorder.prototype);
  Object.assign(recorder, { getContext: () => ({ record: null, consents: true }), supported: () => true, consentButton: {}, select: {}, start: {}, file: {}, uploadArea: {}, stopButton: {}, retry: {}, discard: {} });
  recorder.controls();
  assert.equal(recorder.consentButton.disabled, false);
  assert.equal(recorder.select.hidden, true);
  assert.equal(recorder.start.hidden, true);
});
test("recording confirmation verifies actual storage bytes and rejects incomplete files", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const prefix = new Uint8Array(16);
  prefix.set([0x1a, 0x45, 0xdf, 0xa3]);
  const pending = {
    storagePath: "owner/video.webm",
    bucket: "contract-recordings",
    mimeType: "video/webm",
    byteSize: 999,
  };
  global.fetch = async () =>
    new Response(prefix, {
      status: 206,
      headers: {
        "content-type": "video/webm",
        "content-range": "bytes 0-15/999",
      },
    });
  assert.equal(
    await verifyRecordingObject(
      { url: "https://example.test", key: "test" },
      pending,
    ),
    true,
  );
  await assert.rejects(
    verifyRecordingObject(
      { url: "https://example.test", key: "test" },
      { ...pending, byteSize: 1000 },
    ),
    /stimmt nicht/,
  );
  global.fetch = async () =>
    new Response("not a video data", {
      status: 206,
      headers: {
        "content-type": "video/webm",
        "content-range": "bytes 0-15/999",
      },
    });
  await assert.rejects(
    verifyRecordingObject(
      { url: "https://example.test", key: "test" },
      pending,
    ),
    /stimmt nicht/,
  );
  await assert.rejects(
    completeRecordingUpload(
      {},
      { id: "owner" },
      { status: "draft", video_recording_upload: pending },
      { storagePath: "other/video.webm" },
    ),
    /gehört nicht/,
  );
});
test("resumable upload uses fixed chunks and resumes without resending completed bytes", async () => {
  const size = 6 * 1024 * 1024 + 42;
  const file = new Blob([new Uint8Array(size)]);
  const upload = {
    endpoint: "https://storage.test/upload/resumable",
    token: "signed",
    bucket: "contract-recordings",
    storagePath: "owner/file.webm",
    mimeType: "video/webm",
  };
  let offset = 0;
  const chunks = [];
  let posts = 0;
  const request = async (url, options) => {
    assert.equal(options.headers["x-signature"], "signed");
    if (options.method === "POST") {
      posts++;
      return new Response(null, {
        status: 201,
        headers: { location: "/upload/resumable/one" },
      });
    }
    if (options.method === "HEAD")
      return new Response(null, {
        headers: { "upload-offset": String(offset) },
      });
    assert.equal(Number(options.headers["Upload-Offset"]), offset);
    chunks.push(options.body.size);
    offset += options.body.size;
    return new Response(null, {
      status: 204,
      headers: { "upload-offset": String(offset) },
    });
  };
  await uploadRecordingChunks(file, upload, () => {}, request);
  assert.deepEqual(chunks, [6 * 1024 * 1024, 42]);
  await uploadRecordingChunks(file, upload, () => {}, request);
  assert.equal(posts, 1);
  assert.equal(chunks.length, 2);
});

test('only a verified upload is promoted, with draft and pending-path concurrency guards', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const prefix = new Uint8Array(16);
  prefix.set([0x1a, 0x45, 0xdf, 0xa3]);
  const pending = {bucket:'contract-recordings',storagePath:'owner/video.webm',mimeType:'video/webm',byteSize:999,provider:'device_upload'};
  const contract = {id:'contract',status:'draft',video_recording_upload:pending};
  let patches = 0;
  global.fetch = async (url, options) => {
    if (options.method !== 'PATCH') return new Response(prefix, {status:206,headers:{'content-type':'video/webm','content-range':'bytes 0-15/999'}});
    patches++;
    const query = new URL(url).searchParams;
    assert.equal(query.get('lead_id'),'eq.owner');
    assert.equal(query.get('status'),'eq.draft');
    assert.equal(query.get('video_recording_path'),'is.null');
    assert.equal(query.get('video_recording_upload->>storagePath'),'eq.owner/video.webm');
    const changes=JSON.parse(options.body);
    assert.equal(changes.video_recording_upload,null);
    assert.equal(changes.video_recording_path,pending.storagePath);
    assert.equal(changes.video_recording_ended_at,null);
    return Response.json([{...contract,...changes}]);
  };
  const service={url:'https://example.test',key:'test'};
  const saved = await completeRecordingUpload(service,{id:'owner'},contract,{storagePath:pending.storagePath});
  assert.equal(patches,1);
  await completeRecordingUpload(service,{id:'owner'},saved,{storagePath:pending.storagePath});
  assert.equal(patches,1,'retry after success is idempotent');
  global.fetch=async()=>new Response(null,{status:404});
  await assert.rejects(completeRecordingUpload(service,{id:'owner'},contract,{storagePath:pending.storagePath}),/nicht vollständig/);
});

test('imported video stays local for review until Save is clicked', async()=>{
 const {ContractRecorder}=await import('../lib/browser-contract-recorder.js');
 const recorder=Object.create(ContractRecorder.prototype);
 let previews=0,saves=0;
 Object.assign(recorder,{check:()=>({record:{video_recording_consent_at:'2026-09-21'},contractId:'contract'}),file:{files:[{name:'call.mp4',type:'video/mp4',size:100}],value:'file'},setLocalPreview:()=>previews++,save:()=>saves++,status:()=>{},controls:()=>{},notify:message=>{throw Error(message)}});
 await recorder.importFile();
 assert.equal(previews,1);assert.equal(saves,0);assert.equal(recorder.blob.name,'call.mp4');
});
test('duplicate Save while upload is running does not start another upload',async()=>{
 const {ContractRecorder}=await import('../lib/browser-contract-recorder.js');
 const recorder=Object.create(ContractRecorder.prototype);recorder.blob={size:100};recorder.busy=true;recorder.controls=()=>{throw Error('Upload started twice');};await recorder.save();
});
test('recording remains local after stop until the employee reviews and uploads it', async () => {
  const { readFile } = await import('node:fs/promises');
  const browser = await readFile(new URL('../lib/browser-contract-recorder.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../lib/contract-recording-service.js', import.meta.url), 'utf8');
  assert.match(browser, /this\.recorder\.onstop = \(\) =>[\s\S]*?this\.setLocalPreview\(\)/);
  assert.doesNotMatch(browser, /this\.recorder\.onstop = \(\) =>[\s\S]*?void this\.save\(\)/);
  assert.match(service, /storage\/v1\/upload\/resumable`/);
});
test('browser requires recorded consent and Meet tab audio before it records screen and microphone', async t => {
  const { ContractRecorder } = await import('../lib/browser-contract-recorder.js');
  const originals = Object.fromEntries(['navigator', 'window', 'MediaStream', 'MediaRecorder'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const video = { readyState: 'live', addEventListener() {} };
  const microphone = { readyState: 'live', addEventListener() {} };
  const tabAudio = { readyState: 'live' };
  let withAudio = false, apiCalls = 0, microphoneRequests = 0, displayRequests = 0;
  const display = { getVideoTracks: () => [video], getAudioTracks: () => withAudio ? [tabAudio] : [], getTracks: () => [video, ...(withAudio ? [tabAudio] : [])] };
  const mic = { getAudioTracks: () => [microphone], getTracks: () => [microphone] };
  const navigator = { mediaDevices: { getDisplayMedia: async () => { displayRequests++; return display; }, getUserMedia: async () => { microphoneRequests++; return mic; } } };
  const destination = { stream: { getAudioTracks: () => [microphone] } };
  class FakeAudio { async resume() {} createMediaStreamDestination() { return destination; } createMediaStreamSource() { return { connect() {} }; } }
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'video/webm'; }
    constructor() { this.mimeType = 'video/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['recorded-video']) }); this.onstop(); }
  }
  for (const [key, value] of Object.entries({ navigator, window: { AudioContext: FakeAudio }, MediaStream: class { constructor(tracks) { this.tracks = tracks; } getVideoTracks() { return this.tracks.filter(track => track === video); } }, MediaRecorder: FakeRecorder })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const recorder = Object.create(ContractRecorder.prototype);
  const errors=[];
  Object.assign(recorder, {
    streams: [], busy: false, saved: false, blob: null, confirmedThisSession: false,
    check: () => ({ leadId: 'lead', contractId: 'contract', record: {video_recording_consent_record_id:'audit'} }),
    api: async () => { apiCalls++; }, controls() {}, status: message => errors.push(message), finishCapture() {}, setLocalPreview() {},
    notify: message => errors.push(message),
    preview: { play: async () => {}, hidden: true }, node: { querySelector: () => ({ textContent: '' }) },
  });
  await recorder.selectSource();
  assert.match(errors.pop(), /protokollieren/);
  assert.equal(apiCalls, 0);
  recorder.confirmedThisSession = true;
  await recorder.selectSource();
  assert.match(errors.at(-1), /Meet-Ton/);
  assert.equal(microphoneRequests, 0);
  assert.equal(apiCalls, 0);
  withAudio = true;
  await recorder.selectSource();
  assert.equal(apiCalls, 0, 'source selection must not start the recording');
  assert.equal(displayRequests, 2);
  await recorder.begin();
  assert.equal(recorder.recorder.state, 'recording');
  assert.equal(displayRequests, 2, 'the recording button must not reopen the browser sharing picker');
  assert.equal(apiCalls, 1);
  recorder.stop();
  assert.ok(recorder.blob.size > 0);
  clearInterval(recorder.timer);
});
