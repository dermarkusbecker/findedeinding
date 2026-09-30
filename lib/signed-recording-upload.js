// Upload directly to the private Supabase Storage signed URL. The video never
// travels through a Vercel function, which cannot accept recordings this large.
export async function uploadSignedRecording(
  file,
  upload,
  onProgress = () => {},
  request = fetch,
) {
  if (!upload?.uploadUrl) throw new Error("Der sichere Video-Upload fehlt. Bitte erneut versuchen.");
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file, file.name || "videoaufnahme.mp4");
  let response;
  try {
    response = await request(upload.uploadUrl, {
      method: "PUT",
      headers: { "x-upsert": "false" },
      body,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (error) {
    throw new Error(
      error?.name === "TimeoutError"
        ? "Der Video-Upload hat zu lange gedauert. Bitte erneut versuchen."
        : "Die Verbindung zum Videospeicher wurde unterbrochen. Bitte erneut versuchen.",
    );
  }
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const reason = String(details.message || details.error || "Der Videospeicher hat die Datei abgelehnt.")
      .replace(/https?:\/\/\S+/g, "[URL]")
      .slice(0, 200);
    throw new Error(`Video-Upload fehlgeschlagen (${response.status}): ${reason}`);
  }
  onProgress(file.size, file.size);
}
