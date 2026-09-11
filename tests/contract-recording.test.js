import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRecordingDraft,
  recordingConsents,
  verifyRecordingObject,
  completeRecordingUpload,
} from "../lib/contract-recording-service.js";
import { uploadRecordingChunks } from "../lib/resumable-recording-upload.js";
import {
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
