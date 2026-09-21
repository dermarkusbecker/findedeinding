export function youtubeVideoId(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id;
  if (host === 'youtu.be' && parts.length === 1) id = parts[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
  } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host) && parts.length === 2 && parts[0] === 'embed') id = parts[1];
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

export function normalizeReferences(input) {
  if (typeof input?.enabled !== 'boolean' || !Array.isArray(input?.videos)) throw new Error('Bitte Aktivierung und YouTube-Liste vollständig übermitteln.');
  const seen = new Set();
  const videos = input.videos.map((video, index) => {
    const id = youtubeVideoId(video?.url);
    if (!id) throw new Error(`Video ${index + 1}: Bitte einen gültigen YouTube-Video-Link eingeben.`);
    if (seen.has(id)) throw new Error(`Video ${index + 1}: Dieser YouTube-Link ist bereits enthalten.`);
    seen.add(id);
    return { id, url: `https://www.youtube.com/watch?v=${id}`, title: String(video.title || '').trim().slice(0, 180) };
  });
  if (input.enabled && !videos.length) throw new Error('Bitte mindestens ein YouTube-Video hinzufügen oder Referenzen deaktivieren.');
  return { enabled: input.enabled, videos };
}

export function publicReferences(settings, limit) {
  if (!settings?.enabled) return { enabled: false, videos: [], total: 0 };
  const videos = Array.isArray(settings.videos) ? settings.videos : [];
  return { enabled: true, videos: limit === 6 ? videos.slice(0, 6) : videos, total: videos.length };
}
