import crypto from 'node:crypto';
import { requireCurrentPermission } from '../lib/user-auth.js';
import { getParticipantProgramAccess, serviceHeaders } from '../lib/program-access-service.js';
import { extractDocumentText, CV_EXTRACTION_VERSION } from '../lib/documents/cv-extractor.js';
import { structureCareerHistory } from '../lib/documents/cv-structurer.js';

const allowed = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/webp']);
const safeName = (name) => String(name || 'dokument').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
const normalizedMime = (name, mime) => mime || (/\.pdf$/i.test(name) ? 'application/pdf' : /\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '');

export default async function handler(request, response) {
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
    const upload = await fetch(`${program.service.url}/storage/v1/object/participant-documents/${storagePath}`, { method: 'POST', headers: { apikey: program.service.key, Authorization: `Bearer ${program.service.key}`, 'Content-Type': mimeType, 'x-upsert': 'false' }, body: buffer });
    if (!upload.ok) throw new Error('Das Dokument konnte nicht sicher gespeichert werden.');
    const extraction = await extractDocumentText(buffer, mimeType);
    let extractedData = {};
    let status = extraction.needsOcr ? 'needs_ocr' : 'ready';
    if (!extraction.needsOcr && documentType === 'cv') extractedData = await structureCareerHistory(extraction.text);
    const insert = await fetch(`${program.service.url}/rest/v1/participant_documents`, { method: 'POST', headers: serviceHeaders(program.service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: session.participantId, week: Number(week), document_type: documentType, original_file_name: safeName(fileName), mime_type: mimeType, byte_size: buffer.length, storage_bucket: 'participant-documents', storage_path: storagePath, sha256: hash, processing_status: status, extraction_method: extraction.method, extracted_text: extraction.text || null, extracted_data: extractedData, extraction_version: CV_EXTRACTION_VERSION }) });
    const rows = await insert.json().catch(() => ([]));
    if (!insert.ok || !rows[0]) throw new Error(rows.message || 'Dokumentdatensatz konnte nicht gespeichert werden.');
    return response.status(201).json({ document: { id: rows[0].id, fileName: rows[0].original_file_name, status, extractionMethod: extraction.method, extractedData } });
  } catch (error) { return response.status(error.status || 500).json({ error: error.message || 'Dokument konnte nicht verarbeitet werden.' }); }
}
