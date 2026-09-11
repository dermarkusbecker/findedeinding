import crypto from 'node:crypto';
import { deleteCustomerObject, uploadCustomerObject } from './customer-storage.js';
import { serviceHeaders } from './program-access-service.js';

async function responseRows(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || fallback), { status: response.status, code: data.code || '', details: data });
  return data;
}

function isLegacyDocumentConstraint(error) {
  return error?.code === '23514' || /participant_documents.*check|check constraint|document_type|extraction_method/i.test(error?.message || '');
}

function compatibleDocumentRecords(payload, fallbackDocumentType = '') {
  const candidates = [payload, { ...payload, extraction_method: 'manual' }];
  if (fallbackDocumentType && fallbackDocumentType !== payload.document_type) {
    candidates.push(
      { ...payload, document_type: fallbackDocumentType },
      { ...payload, document_type: fallbackDocumentType, extraction_method: 'manual' },
    );
  }
  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.document_type === candidate.document_type && item.extraction_method === candidate.extraction_method) === index);
}

export async function storeGeneratedParticipantDocument({
  service, participantId, buffer, fileName, documentType, fallbackDocumentType = '', title,
  extractedData, extractionVersion, confirmedAt = new Date().toISOString(),
}) {
  if (!participantId || !Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Das erzeugte Dokument ist unvollständig und konnte nicht abgelegt werden.');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const stored = await uploadCustomerObject(service, 'documents', participantId, { buffer, fileName, mimeType: 'application/pdf', sha256 });
  const payload = {
    user_profile_id: participantId,
    week: 0,
    document_type: documentType,
    display_title: title,
    original_file_name: fileName,
    mime_type: 'application/pdf',
    byte_size: buffer.length,
    storage_bucket: stored.bucket,
    storage_path: stored.storagePath,
    sha256,
    processing_status: 'ready',
    extraction_method: 'pdf_form_fill',
    extracted_data: extractedData,
    extraction_version: extractionVersion,
    participant_confirmed_at: confirmedAt,
    source: 'system',
    visibility: 'customer',
    uploaded_by_profile_id: participantId,
  };
  const insert = async (record) => responseRows(await fetch(`${service.url}/rest/v1/participant_documents`, {
    method: 'POST',
    headers: serviceHeaders(service.key, { Prefer: 'return=representation' }),
    body: JSON.stringify(record),
  }), `${title} konnte nicht in der Dokumentenakte gespeichert werden.`);
  try {
    let rows = null;
    let lastError = null;
    for (const candidate of compatibleDocumentRecords(payload, fallbackDocumentType)) {
      try {
        rows = await insert(candidate);
        break;
      } catch (error) {
        lastError = error;
        if (!isLegacyDocumentConstraint(error)) throw error;
      }
    }
    if (!rows) throw lastError || new Error(`${title} konnte nicht in der Dokumentenakte gespeichert werden.`);
    const document = rows[0];
    if (!document?.id || document.user_profile_id !== participantId || document.storage_bucket !== stored.bucket || document.storage_path !== stored.storagePath) {
      throw new Error(`${title} wurde nicht eindeutig mit der Kundenakte verknüpft.`);
    }
    return document;
  } catch (error) {
    await deleteCustomerObject(service, stored.bucket, stored.storagePath);
    throw error;
  }
}
