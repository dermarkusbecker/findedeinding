import { createSignedCustomerUpload } from "./customer-storage.js";
const fail = (message, status = 409) =>
  Object.assign(new Error(message), { status });
export function assertRecordingDraft(contract) {
  if (contract.status !== "draft" || contract.video_contract_confirmed_at)
    throw fail(
      "Dieser Vertrag ist bereits abgeschlossen. Seine Aufnahme kann nicht ersetzt werden.",
    );
  if (contract.video_recording_path)
    throw fail("Zu diesem Vertrag ist bereits eine Aufnahme gespeichert.");
}
export function recordingConsents(body) {
  return [
    "recordingConsent",
    "recordingPurposeAccepted",
    "recordingRevocationAccepted",
  ].every((key) => body?.[key] === true);
}
const headers = (service) => ({
  apikey: service.key,
  Authorization: `Bearer ${service.key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
});
async function patch(service, leadId, contractId, changes, condition = "") {
  const response = await fetch(
    `${service.url}/rest/v1/lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}&status=eq.draft${condition}`,
    {
      method: "PATCH",
      headers: headers(service),
      body: JSON.stringify(changes),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw fail(
      data.message || "Aufnahme konnte nicht zugeordnet werden.",
      response.status,
    );
  if (!data[0])
    throw fail(
      "Der Vertrag wurde zwischenzeitlich geändert. Bitte neu öffnen.",
    );
  return data[0];
}
export async function beginRecording(service, lead, contract, body) {
  assertRecordingDraft(contract);
  if (!recordingConsents(body))
    throw fail(
      "Alle drei Hinweise zur konkreten Aufzeichnung müssen vor Beginn ausdrücklich bestätigt sein.",
      400,
    );
  const startedAt = new Date().toISOString();
  await patch(
    service,
    lead.id,
    contract.id,
    {
      video_recording_consent_at: startedAt,
      video_recording_started_at:
        body.provider === "browser_screen" ? startedAt : null,
    },
    "&video_recording_path=is.null",
  );
  return startedAt;
}
export async function prepareRecordingUpload(service, lead, contract, body) {
  assertRecordingDraft(contract);
  if (!recordingConsents(body) || !contract.video_recording_consent_at)
    throw fail("Bitte zuerst die Einwilligung zur Aufnahme protokollieren.");
  const mimeType = String(body.mimeType || "")
    .split(";")[0]
    .toLowerCase();
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(mimeType))
    throw fail("Bitte eine MP4-, WebM- oder MOV-Videodatei auswählen.", 415);
  const upload = await createSignedCustomerUpload(
    service,
    "contractRecordings",
    lead.id,
    { fileName: body.fileName, mimeType, byteSize: body.byteSize },
  );
  const pending = {
    bucket: upload.bucket,
    storagePath: upload.storagePath,
    mimeType: upload.mimeType,
    byteSize: upload.byteSize,
    endedAt:
      body.provider === "browser_screen" &&
      Number.isFinite(Date.parse(body.endedAt)) &&
      Date.parse(body.endedAt) <= Date.now()
        ? new Date(body.endedAt).toISOString()
        : null,
    provider:
      body.provider === "browser_screen" ? "browser_screen" : "device_upload",
    preparedAt: new Date().toISOString(),
  };
  await patch(
    service,
    lead.id,
    contract.id,
    { video_recording_upload: pending },
    "&video_recording_path=is.null",
  );
  const token = new URL(upload.uploadUrl).searchParams.get("token");
  if (!token) throw fail("Der Upload konnte nicht autorisiert werden.", 502);
  return {
    ...upload,
    token,
    endpoint: `${service.url}/storage/v1/upload/resumable/sign`,
  };
}
export async function verifyRecordingObject(service, pending) {
  const encoded = pending.storagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const response = await fetch(
    `${service.url}/storage/v1/object/authenticated/${pending.bucket}/${encoded}`,
    { headers: { ...headers(service), Range: "bytes=0-15" } },
  );
  if (!response.ok)
    throw fail(
      "Die Videodatei ist noch nicht vollständig im Speicher angekommen. Bitte erneut versuchen.",
    );
  const actualSize = Number(
    response.status === 206
      ? response.headers.get("content-range")?.split("/")[1]
      : response.headers.get("content-length"),
  );
  const actualType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .toLowerCase();
  const reader = response.body?.getReader();
  let prefix = new Uint8Array();
  if (reader) {
    try {
      while (prefix.length < 16) {
        const { value, done } = await reader.read();
        if (done) break;
        const next = new Uint8Array(prefix.length + value.length);
        next.set(prefix);
        next.set(value, prefix.length);
        prefix = next;
      }
    } finally {
      await reader.cancel();
    }
  }
  const webm =
    prefix[0] === 0x1a &&
    prefix[1] === 0x45 &&
    prefix[2] === 0xdf &&
    prefix[3] === 0xa3;
  const mp4 = String.fromCharCode(...prefix.slice(4, 8)) === "ftyp";
  if (
    actualSize !== pending.byteSize ||
    actualType !== pending.mimeType ||
    !(pending.mimeType === "video/webm" ? webm : mp4)
  )
    throw fail(
      "Die gespeicherte Datei stimmt nicht mit dem angekündigten Video überein. Bitte erneut hochladen.",
    );
  return true;
}
export async function completeRecordingUpload(service, lead, contract, body) {
  if (
    contract.video_recording_path === body.storagePath &&
    contract.video_recording_imported_at
  )
    return contract;
  assertRecordingDraft(contract);
  const pending = contract.video_recording_upload;
  if (!pending || pending.storagePath !== body.storagePath)
    throw fail("Dieser Upload gehört nicht zur vorbereiteten Aufnahme.");
  await verifyRecordingObject(service, pending);
  const now = new Date().toISOString();
  return patch(
    service,
    lead.id,
    contract.id,
    {
      video_recording_bucket: pending.bucket,
      video_recording_path: pending.storagePath,
      video_recording_mime_type: pending.mimeType,
      video_recording_bytes: pending.byteSize,
      video_recording_provider: pending.provider,
      video_recording_ended_at: pending.endedAt || null,
      video_recording_imported_at: now,
      video_recording_upload: null,
      video_recording_reviewed_at: null,
    },
    `&video_recording_path=is.null&video_recording_upload->>storagePath=eq.${encodeURIComponent(pending.storagePath)}`,
  );
}
