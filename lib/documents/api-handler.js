import crypto from 'node:crypto';
import { requireCurrentPermission } from '../user-auth.js';
import { getParticipantProgramAccess, serviceHeaders } from '../program-access-service.js';
import { extractDocumentText, CV_EXTRACTION_VERSION } from './cv-extractor.js';
import { structureCareerHistory } from './cv-structurer.js';

const allowed = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/webp']);
const documentBucket = 'participant-documents';
const safeName = (name) => String(name || 'dokument').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
const normalizedMime = (name, mime) => mime || (/\.pdf$/i.test(name) ? 'application/pdf' : /\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '');

export async function ensureDocumentBucket(service, fetchImpl = fetch) {
  const headers = { apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json' };
  const existing = await fetchImpl(`${service.url}/storage/v1/bucket/${documentBucket}`, { headers });
  if (existing.ok) return;
  const details = await existing.json().catch(() => ({}));
  const missing = existing.status === 404 || /bucket\s+not\s+found/i.test(`${details.message || ''} ${details.error || ''}`);
  if (!missing) {
    throw new Error(details.message || details.error || 'Der sichere Dokumentenspeicher ist nicht erreichbar.');
  }
  const created = await fetchImpl(`${service.url}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: documentBucket, name: documentBucket, public: false, file_size_limit: 10 * 1024 * 1024, allowed_mime_types: [...allowed] }),
  });
  if (!created.ok && created.status !== 409) {
    const details = await created.json().catch(() => ({}));
    throw new Error(details.message || details.error || 'Der sichere Dokumentenspeicher konnte nicht vorbereitet werden.');
  }
}

export async function handleParticipantDocument(request, response) {
  const session = await requireCurrentPermission('documents')(request, response);
  if (!session) return;
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  try {
    const program = await getParticipantProgramAccess(session.participantId);
    const { fileName, contentBase64, documentType = 'cv', week = 1 } = request.body || {};
    const mimeType = normalizedMime(fileName, request.body?.mimeType);
    if (!allowed.has(mimeType)) return response.status(415).json({ error: 'Bitte lade eine PDF-, DOCX- oder Bilddatei hoch.' });
    const buffer = Buffer.from(String(contentBase64 || ''), 'base64');
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) return response.status(413).json({ error: 'Die Datei fehlt oder ist größer als 10 MB.' });
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storagePath = `${session.participantId}/${crypto.randomUUID()}-${safeName(fileName)}`;
    await ensureDocumentBucket(program.service);
    const upload = await fetch(`${program.service.url}/storage/v1/object/${documentBucket}/${storagePath}`, { method: 'POST', headers: { apikey: program.service.key, Authorization: `Bearer ${program.service.key}`, 'Content-Type': mimeType, 'x-upsert': 'false' }, body: buffer });
    if (!upload.ok) {
      const details = await upload.json().catch(() => ({}));
      throw new Error(details.message || details.error || 'Das Dokument konnte nicht sicher gespeichert werden.');
    }
    try {
      let extraction = { text: '', method: null, needsOcr: false };
      let extractedData = {};
      let status = 'failed';
      try {
        extraction = await extractDocumentText(buffer, mimeType);
        status = extraction.needsOcr ? 'needs_ocr' : 'ready';
        if (!extraction.needsOcr && documentType === 'cv') {
          try { extractedData = await structureCareerHistory(extraction.text); }
          catch { extractedData = { stations: [] }; }
        }
      } catch { status = 'failed'; }
      const insert = await fetch(`${program.service.url}/rest/v1/participant_documents`, { method: 'POST', headers: serviceHeaders(program.service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: session.participantId, week: Number(week), document_type: documentType, original_file_name: safeName(fileName), mime_type: mimeType, byte_size: buffer.length, storage_bucket: documentBucket, storage_path: storagePath, sha256: hash, processing_status: status, extraction_method: extraction.method, extracted_text: extraction.text || null, extracted_data: extractedData, extraction_version: CV_EXTRACTION_VERSION }) });
      const rows = await insert.json().catch(() => ([]));
      if (!insert.ok || !rows[0]) throw new Error(rows.message || 'Dokumentdatensatz konnte nicht gespeichert werden.');
      return response.status(201).json({ document: { id: rows[0].id, fileName: rows[0].original_file_name, status, extractionMethod: extraction.method, extractedData } });
    } catch (error) {
      await fetch(`${program.service.url}/storage/v1/object/${documentBucket}/${storagePath}`, { method: 'DELETE', headers: { apikey: program.service.key, Authorization: `Bearer ${program.service.key}` } }).catch(() => null);
      throw error;
    }
  } catch (error) { return response.status(error.status || 500).json({ error: error.message || 'Dokument konnte nicht verarbeitet werden.' }); }
}
