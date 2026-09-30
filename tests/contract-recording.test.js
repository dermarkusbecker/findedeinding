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
import { uploadSignedRecording } from "../lib/signed-recording-upload.js";
import {
  ContractRecorder,
  recordingFileType,
} from "../lib/device-contract-recorder.js";
test("native recording files accept MP4, WebM and Apple MOV", () => {
  assert.equal(recordingFileType({ name: "Aufnahme.MOV", type: "" }), "video/quicktime");
  assert.equal(recordingFileType({ name: "Aufnahme.mp4", type: "video/mp4" }), "video/mp4");
  assert.equal(recordingFileType({ name: "x.pdf", type: "application/pdf" }), "");
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
  Object.assign(recorder, { getContext: () => ({ record: null, consents: true }), consentButton: {}, start: {}, file: {}, uploadArea: {}, retry: {}, discard: {} });
  recorder.controls();
  assert.equal(recorder.consentButton.disabled, false);
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
test("signed recording upload sends the file directly to private Storage", async () => {
  const file = new File(["recording"], "aufnahme.mov", { type: "video/quicktime" });
  const upload = { uploadUrl: "https://storage.test/storage/v1/object/upload/sign/contract-recordings/owner/video.mov?token=secret" };
  let progress;
  await uploadSignedRecording(file, upload, (sent, total) => { progress = [sent, total]; }, async (url, options) => {
    assert.equal(url, upload.uploadUrl);
    assert.equal(options.method, "PUT");
    assert.equal(options.headers["x-upsert"], "false");
    assert.equal(options.body.get("cacheControl"), "3600");
    assert.equal(options.body.get("").name, file.name);
    assert.equal(options.body.get("").size, file.size);
    assert.equal(options.headers["Content-Type"], undefined);
    return new Response(JSON.stringify({ Key: "owner/video.mov" }), { status: 200 });
  });
  assert.deepEqual(progress, [file.size, file.size]);
});

test("signed recording upload reports Storage's 400 reason without revealing its URL", async () => {
  const file = new Blob(["recording"], { type: "video/webm" });
  const upload = { uploadUrl: "https://storage.test/path?token=secret" };
  await assert.rejects(
    uploadSignedRecording(file, upload, undefined, async () =>
      new Response(JSON.stringify({ message: "Invalid Compact JWS" }), { status: 400 })),
    error => {
      assert.match(error.message, /Video-Upload fehlgeschlagen \(400\): Invalid Compact JWS/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
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
 const {ContractRecorder}=await import('../lib/device-contract-recorder.js');
 const recorder=Object.create(ContractRecorder.prototype);
 let previews=0,saves=0;
 Object.assign(recorder,{check:()=>({record:{video_recording_consent_at:'2026-09-21'},contractId:'contract'}),file:{files:[{name:'call.mp4',type:'video/mp4',size:100}],value:'file'},setLocalPreview:()=>previews++,save:()=>saves++,status:()=>{},controls:()=>{},notify:message=>{throw Error(message)}});
 await recorder.importFile();
 assert.equal(previews,1);assert.equal(saves,0);assert.equal(recorder.blob.name,'call.mp4');
});
test('duplicate Save while upload is running does not start another upload',async()=>{
 const {ContractRecorder}=await import('../lib/device-contract-recorder.js');
 const recorder=Object.create(ContractRecorder.prototype);recorder.blob={size:100};recorder.busy=true;recorder.controls=()=>{throw Error('Upload started twice');};await recorder.save();
});
test('native capture workflow never invokes browser screen sharing and keeps upload manual', async () => {
  const { readFile } = await import('node:fs/promises');
  const device = await readFile(new URL('../lib/device-contract-recorder.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../lib/contract-recording-service.js', import.meta.url), 'utf8');
  assert.doesNotMatch(device, /getDisplayMedia|MediaRecorder|start-video-recording/);
  assert.match(device, /this\.file\.onchange = \(\) => this\.importFile\(\)/);
  assert.match(device, /this\.retry\.onclick = \(\) => this\.save\(\)/);
  assert.match(service, /storage\/v1\/upload\/resumable`/);
});
test('recording start shows the native shortcut and enables upload only after consent', t => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => originalNavigator ? Object.defineProperty(globalThis, 'navigator', originalNavigator) : delete globalThis.navigator);
  const recorder = Object.create(ContractRecorder.prototype);
  const guide = { hidden: true, innerHTML: '', scrollIntoView() {} };
  const record = { status:'draft', video_recording_consent_at:'2026-09-30', video_recording_consent_record_id:'audit' };
  Object.assign(recorder, { confirmedThisSession:true, busy:false, blob:null, guide, consentButton:{}, start:{}, file:{}, uploadArea:{}, retry:{}, discard:{},
    getContext: () => ({ contractId:'contract', leadId:'lead', consents:true, record }), status() {}, notify:message=>{throw Error(message)} });
  recorder.controls();
  assert.equal(recorder.start.hidden, false);
  assert.equal(recorder.file.disabled, false);
  Object.defineProperty(globalThis, 'navigator', { value:{ platform:'MacIntel' }, configurable:true });
  recorder.openNativeGuide();
  assert.match(guide.innerHTML, /⇧ ⌘ 5/);
  assert.equal(guide.hidden, false);
  Object.defineProperty(globalThis, 'navigator', { value:{ platform:'Win32' }, configurable:true });
  recorder.openNativeGuide();
  assert.match(guide.innerHTML, /Win \+ Umschalt \+ R/);
});
