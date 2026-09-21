import { requireCurrentAdmin, authHeaders, supabaseAuthConfig } from './user-auth.js';
import { normalizeReferences, publicReferences, youtubeVideoId } from './references.js';

export async function handleReferences(request, response) {
  const action = request.query?.action;
  const isPublic = ['references-public', 'references-thumbnail'].includes(action);
  response.setHeader('Cache-Control', 'private, no-store');
  let admin;
  if (!isPublic) {
    admin = await requireCurrentAdmin(request, response, 'settings');
    if (!admin) return;
  }
  if (!['GET', 'PATCH'].includes(request.method) || (action !== 'references-settings' && request.method !== 'GET')) return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Referenzen sind derzeit nicht erreichbar.' });
  const query = async (path, options = {}) => {
    const result = await fetch(`${config.url}/rest/v1/${path}`, { ...options, headers: { ...authHeaders(config.serviceKey), Prefer: 'return=representation' } });
    if (!result.ok) throw new Error('Referenzen konnten nicht gespeichert oder geladen werden.');
    return result.json();
  };
  try {
    if (action === 'references-preview') {
      const id = youtubeVideoId(request.query?.url);
      if (!id) return response.status(400).json({ error: 'Bitte einen gültigen YouTube-Video-Link eingeben.' });
      let title = '';
      try {
        const result = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
        if (result.ok) title = String((await result.json()).title || '').slice(0, 180);
      } catch { /* A title is optional; owners can supply it themselves. */ }
      return response.json({ video: { id, url: `https://www.youtube.com/watch?v=${id}`, title } });
    }
    if (action === 'references-settings' && request.method === 'PATCH') {
      let normalized;
      try { normalized = normalizeReferences(request.body); } catch (error) { return response.status(400).json({ error: error.message }); }
      const revision = request.body?.updated_at;
      if (typeof revision !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(revision)) return response.status(400).json({ error: 'Bitte die Einstellungen zuerst neu laden.' });
      const rows = await query(`landing_references?id=eq.default&updated_at=eq.${encodeURIComponent(revision)}`, {
        method: 'PATCH', body: JSON.stringify({ ...normalized, updated_at: new Date().toISOString(), updated_by: admin.profileId }),
      });
      if (!rows.length) return response.status(409).json({ error: 'Die Referenzen wurden zwischenzeitlich geändert. Bitte neu laden und deine Änderungen erneut übernehmen.' });
      return response.json({ settings: rows[0] });
    }
    const settings = (await query('landing_references?id=eq.default&select=enabled,videos,updated_at'))[0];
    if (!settings) throw new Error('Referenz-Einstellungen fehlen.');
    if (action === 'references-settings') return response.json({ settings });
    if (action === 'references-public') return response.json(publicReferences(settings, request.query?.limit === '6' ? 6 : undefined));
    if (action === 'references-thumbnail') {
      const id = String(request.query?.id || '');
      if (!/^[\w-]{11}$/.test(id) || !settings.enabled || !settings.videos.some(video => video.id === id)) return response.status(404).end();
      // Same-origin preview: visitors contact YouTube only when they start a video.
      const result = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!result.ok || !result.headers.get('content-type')?.startsWith('image/')) return response.status(404).end();
      const bytes = Buffer.from(await result.arrayBuffer());
      if (bytes.length > 2000000) return response.status(502).end();
      response.setHeader('Content-Type', 'image/jpeg');
      return response.status(200).send(bytes);
    }
    return response.status(404).json({ error: 'Nicht gefunden.' });
  } catch {
    return response.status(503).json({ error: 'Referenzen sind gerade nicht erreichbar. Bitte erneut versuchen.' });
  }
}
