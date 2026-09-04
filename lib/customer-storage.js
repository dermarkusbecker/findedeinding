import crypto from 'node:crypto';

const BUCKETS = Object.freeze({
  documents: { id: 'participant-documents', limit: 10 * 1024 * 1024, types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'image/webp'] },
  avatars: { id: 'participant-avatars', limit: 3 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
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
  if (existing.ok) return bucket;
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

export async function signedCustomerUrl(service, bucket, storagePath, expiresIn = 600) {
  if (!bucket || !storagePath) return null;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const result = await fetch(`${service.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, { method: 'POST', headers: storageHeaders(service.key), body: JSON.stringify({ expiresIn }) });
  const details = await result.json().catch(() => ({}));
  if (!result.ok || !details.signedURL) return null;
  return `${service.url}/storage/v1${details.signedURL}`;
}

export async function deleteCustomerObject(service, bucket, storagePath) {
  if (!bucket || !storagePath) return;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  await fetch(`${service.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, { method: 'DELETE', headers: storageHeaders(service.key) }).catch(() => null);
}
