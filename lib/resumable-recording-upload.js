// Minimal TUS client for private signed Supabase uploads. Keeps its URL across
// retries in the open page; video bytes never pass through a Vercel function.
const CHUNK = 6 * 1024 * 1024;
const encode = (value) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)));
export async function uploadRecordingChunks(
  file,
  upload,
  onProgress = () => {},
  request = fetch,
) {
  const base = { "Tus-Resumable": "1.0.0", "x-signature": upload.token };
  const call = async (url, options) => {
    const result = await request(url, {
      ...options,
      signal: AbortSignal.timeout(120000),
    });
    if (!result.ok)
      throw new Error(
        `Video-Upload unterbrochen (${result.status}). Bitte erneut versuchen.`,
      );
    return result;
  };
  if (!upload.resumeUrl) {
    const metadata = {
      bucketName: upload.bucket,
      objectName: upload.storagePath,
      contentType: upload.mimeType,
      cacheControl: "3600",
    };
    const created = await call(upload.endpoint, {
      method: "POST",
      headers: {
        ...base,
        "Upload-Length": String(file.size),
        "Upload-Metadata": Object.entries(metadata)
          .map(([key, value]) => `${key} ${encode(value)}`)
          .join(","),
      },
    });
    const location = created.headers.get("location");
    if (!location)
      throw new Error("Der Upload konnte nicht vorbereitet werden.");
    const target = new URL(location, upload.endpoint);
    if (target.origin !== new URL(upload.endpoint).origin)
      throw new Error("Ungültiges Uploadziel.");
    upload.resumeUrl = target.href;
  }
  let failures = 0;
  while (true) {
    try {
      const head = await call(upload.resumeUrl, {
        method: "HEAD",
        headers: base,
      });
      let offset = Number(head.headers.get("upload-offset"));
      if (!Number.isInteger(offset) || offset < 0 || offset > file.size)
        throw new Error("Ungültiger Uploadfortschritt.");
      onProgress(offset, file.size);
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK, file.size);
        const result = await call(upload.resumeUrl, {
          method: "PATCH",
          headers: {
            ...base,
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: file.slice(offset, end),
        });
        if (Number(result.headers.get("upload-offset")) !== end)
          throw new Error("Der Upload wurde nicht vollständig bestätigt.");
        offset = end;
        failures = 0;
        onProgress(offset, file.size);
      }
      return;
    } catch (error) {
      if (++failures > 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, failures * 1000));
    }
  }
}
