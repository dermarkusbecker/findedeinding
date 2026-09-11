import crypto from 'node:crypto';

const BUCKETS = Object.freeze({
  documents: { id: 'participant-documents', limit: 10 * 1024 * 1024, types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/webp'] },
  avatars: { id: 'participant-avatars', limit: 3 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
  contractRecordings: { id: 'contract-recordings', limit: 50 * 1024 * 1024, types: ['video/webm', 'video/mp4', 'video/quicktime', 'audio/webm'] },
});

const safeName = (value = 'datei') => String(value).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
const storageHeaders = (key, contentType = 'application/json') => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType });

export function storageDefinition(kind) {
  return BUCKETS[kind] || null;
}

export async function ensureCustomerBucket(service, kind) {
  const bucket = storageDefinition(kind);
  if (!bucket) throw new Error('Unbekannter Speicherbereich.');
  const existing = await fetch(`${service.url}/storage/v1/bucket/${bucket.id}`, { headers: storageHeaders(service.key) });
  if (existing.ok) {
    if (kind === 'contractRecordings') {
      const current = await existing.json();
      if (current.allowed_mime_types && !bucket.types.every(type => current.allowed_mime_types.includes(type))) {
        const updated = await fetch(`${service.url}/storage/v1/bucket/${bucket.id}`, {method:'PUT',headers:storageHeaders(service.key),body:JSON.stringify({public:false,allowed_mime_types:bucket.types})});
        if(!updated.ok) throw new Error('Videoformate konnten nicht im Speicher freigegeben werden.');
      }
    }
    return bucket;
  }
  const created = await fetch(`${service.url}/storage/v1/bucket`, { method: 'POST', headers: storageHeaders(service.key), body: JSON.stringify({ id: bucket.id, name: bucket.id, public: false, file_size_limit: bucket.limit, allowed_mime_types: bucket.types }) });
  if (!created.ok && created.status !== 409) {
    const details = await created.json().catch(() => ({}));
    throw new Error(details.message || details.error || 'Der sichere Dateispeicher konnte nicht vorbereitet werden.');
  }
  return bucket;
}

export function decodeCustomerUpload({ fileName, mimeType, contentBase64 }, kind) {
  const bucket = storageDefinition(kind);
  const normalizedType = String(mimeType || '').toLowerCase();
  if (!bucket?.types.includes(normalizedType)) throw Object.assign(new Error(kind === 'avatars' ? 'Bitte ein PNG-, JPG- oder WebP-Bild auswählen.' : 'Bitte eine PDF-, DOCX- oder Bilddatei auswählen.'), { status: 415 });
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64');
  if (!buffer.length || buffer.length > bucket.limit) throw Object.assign(new Error(`Die Datei fehlt oder ist größer als ${Math.round(bucket.limit / 1024 / 1024)} MB.`), { status: 413 });
  return { buffer, fileName: safeName(fileName), mimeType: normalizedType, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

export async function uploadCustomerObject(service, kind, participantId, upload) {
  const bucket = await ensureCustomerBucket(service, kind);
  const storagePath = `${participantId}/${crypto.randomUUID()}-${upload.fileName}`;
  const result = await fetch(`${service.url}/storage/v1/object/${bucket.id}/${storagePath}`, { method: 'POST', headers: { ...storageHeaders(service.key, upload.mimeType), 'x-upsert': 'false' }, body: upload.buffer });
  if (!result.ok) {
    const details = await result.json().catch(() => ({}));
    throw new Error(details.message || details.error || 'Die Datei konnte nicht sicher gespeichert werden.');
  }
  return { bucket: bucket.id, storagePath };
}

export async function createSignedCustomerUpload(service, kind, ownerId, { fileName, mimeType, byteSize }) {
  const bucket = await ensureCustomerBucket(service, kind);
  const normalizedType = String(mimeType || '').toLowerCase().split(';')[0];
  if (!bucket.types.includes(normalizedType)) throw Object.assign(new Error('Die Aufzeichnung muss als WebM- oder MP4-Datei vorliegen.'), { status: 415 });
  if (!Number.isFinite(Number(byteSize)) || Number(byteSize) <= 0 || Number(byteSize) > bucket.limit) throw Object.assign(new Error('Die Aufzeichnung fehlt oder überschreitet 50 MB.'), { status: 413 });
  const storagePath = `${ownerId}/${crypto.randomUUID()}-${safeName(fileName || 'videovertrag.webm')}`;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const result = await fetch(`${service.url}/storage/v1/object/upload/sign/${bucket.id}/${encodedPath}`, { method: 'POST', headers: storageHeaders(service.key), body: '{}' });
  const details = await result.json().catch(() => ({}));
  if (!result.ok || !details.url) throw new Error(details.message || details.error || 'Der sichere Upload für die Videoaufzeichnung konnte nicht vorbereitet werden.');
  const uploadUrl = details.url.startsWith('http') ? details.url : `${service.url}/storage/v1${details.url.startsWith('/') ? '' : '/'}${details.url}`;
  return { bucket: bucket.id, storagePath, uploadUrl, mimeType: normalizedType, byteSize: Number(byteSize) };
}

export async function importCustomerObject(service, kind, ownerId, { fileName, mimeType, byteSize, sourceResponse }) {
  const bucket = await ensureCustomerBucket(service, kind);
  const normalizedType = String(mimeType || '').toLowerCase().split(';')[0];
  const normalizedSize = Number(byteSize);
  if (!bucket.types.includes(normalizedType)) throw Object.assign(new Error('Die Google-Meet-Aufzeichnung muss als MP4-Datei vorliegen.'), { status: 415 });
  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0 || normalizedSize > bucket.limit) throw Object.assign(new Error(`Die Google-Meet-Aufzeichnung fehlt oder überschreitet ${Math.round(bucket.limit / 1024 / 1024)} MB.`), { status: 413 });
  if (!sourceResponse?.ok || !sourceResponse.body) throw new Error('Google Drive hat keine lesbare Aufzeichnungsdatei geliefert.');
  const storagePath = `${ownerId}/${crypto.randomUUID()}-${safeName(fileName || 'google-meet-videovertrag.mp4')}`;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const result = await fetch(`${service.url}/storage/v1/object/${bucket.id}/${encodedPath}`, {
    method: 'POST',
    headers: { ...storageHeaders(service.key, normalizedType), 'Content-Length': String(normalizedSize), 'x-upsert': 'false' },
    body: sourceResponse.body,
    duplex: 'half',
  });
  if (!result.ok) {
    const details = await result.json().catch(() => ({}));
    throw new Error(details.message || details.error || 'Die Google-Meet-Aufzeichnung konnte nicht in der Kundenakte gespeichert werden.');
  }
  return { bucket: bucket.id, storagePath, mimeType: normalizedType, byteSize: normalizedSize };
}

export async function customerObjectExists(service, bucket, storagePath) {
  if (!bucket || !storagePath) return false;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const result = await fetch(`${service.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, { headers: { ...storageHeaders(service.key, 'application/octet-stream'), Range: 'bytes=0-0' } });
  return result.ok;
}

export async function signedCustomerUrl(service, bucket, storagePath, expiresIn = 600) {
  if (!bucket || !storagePath) return null;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const result = await fetch(`${service.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, { method: 'POST', headers: storageHeaders(service.key), body: JSON.stringify({ expiresIn }) });
  const details = await result.json().catch(() => ({}));
  if (!result.ok || !details.signedURL) return null;
  return details.signedURL.startsWith('http') ? details.signedURL : `${service.url}/storage/v1${details.signedURL.startsWith('/') ? '' : '/'}${details.signedURL}`;
}

export async function deleteCustomerObject(service, bucket, storagePath) {
  if (!bucket || !storagePath) return;
  await fetch(`${service.url}/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', headers: storageHeaders(service.key), body: JSON.stringify({ prefixes: [storagePath] }) }).catch(() => null);
}
