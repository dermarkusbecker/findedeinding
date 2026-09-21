import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeVideoId, normalizeReferences, publicReferences } from '../lib/references.js';
import { handleReferences } from '../lib/references-api.js';
import { createSession } from '../lib/auth.js';

const id = 'M7lc1UVf-VE';
const videos = Array.from({ length: 9 }, (_, index) => ({ url: `https://youtu.be/${String(index).padStart(11, '0')}`, title: `Video ${index}` }));

test('YouTube parser accepts video URL variants and rejects non-video or forged hosts', () => {
  for (const url of [`https://youtu.be/${id}?si=abc`, `https://www.youtube.com/watch?v=${id}&t=30`, `https://m.youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) assert.equal(youtubeVideoId(url), id);
  for (const url of [`https://youtube.com.evil.test/watch?v=${id}`, `https://evil.test@youtube.com/watch?v=${id}`, 'javascript:alert(1)', 'https://youtube.com/playlist?list=abc', 'https://youtube.com/@user', `https://youtu.be/${id}/extra`, `https://youtube.com:8443/watch?v=${id}`, 'https://youtu.be/short']) assert.equal(youtubeVideoId(url), null);
});

test('References preserve order, publish at most six on landing and all on the reference page', () => {
  const settings = normalizeReferences({ enabled: true, videos });
  assert.equal(publicReferences(settings, 6).videos.length, 6);
  assert.equal(publicReferences(settings).videos.length, 9);
  assert.equal(publicReferences(settings, 6).total, 9);
  assert.equal(settings.videos[0].title, 'Video 0');
  assert.deepEqual(publicReferences({ ...settings, enabled: false }), { enabled: false, videos: [], total: 0 });
  assert.equal(normalizeReferences({ ...settings, enabled: false }).videos.length, 9);
  assert.throws(() => normalizeReferences({ enabled: true, videos: [] }), /mindestens/);
  assert.throws(() => normalizeReferences({ enabled: true, videos: [videos[0], videos[0]] }), /bereits/);
  assert.throws(() => normalizeReferences({ enabled: true, videos: [{ url: 'https://vimeo.com/123' }] }), /YouTube/);
});

function response() {
  return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(value) { this.code = value; return this; }, json(value) { this.data = value; return this; }, send(value) { this.data = value; return this; }, end() { return this; } };
}

test('Reference API protects settings, filters public data, validates writes and rejects stale revisions', async () => {
  const original = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'AUTH_SECRET'];
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { SUPABASE_URL: 'https://database.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', AUTH_SECRET: 'test-only' });
  const token = createSession('test', 'admin', { profileId: '00000000-0000-4000-8000-000000000001' });
  let settings = { ...normalizeReferences({ enabled: true, videos }), updated_at: '2026-09-21T12:00:00+00:00' };
  let permission = 'settings';
  let writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('user_profiles?')) return Response.json([{ id: '00000000-0000-4000-8000-000000000001', role: 'admin', status: 'active', staff_permissions: [permission] }]);
    assert.ok(url.startsWith('https://database.test/rest/v1/landing_references?'));
    if (options.method === 'PATCH') {
      writes++;
      if (!url.includes(encodeURIComponent(settings.updated_at))) return Response.json([]);
      settings = JSON.parse(options.body);
    }
    return Response.json([settings]);
  };
  const call = async (action, method = 'GET', body, authenticated = false, extra = {}) => {
    const res = response();
    await handleReferences({ query: { action, ...extra }, method, body, headers: authenticated ? { authorization: `Bearer ${token}` } : {} }, res);
    return res;
  };
  try {
    assert.equal((await call('references-settings')).code, 401);
    assert.equal((await call('references-preview')).code, 401);
    permission = 'finance';
    assert.equal((await call('references-settings', 'PATCH', {}, true)).code, 403);
    permission = 'settings';
    const landing = await call('references-public', 'GET', null, false, { limit: '6' });
    assert.equal(landing.data.videos.length, 6);
    assert.equal(landing.data.updated_by, undefined);
    assert.equal((await call('references-public', 'PATCH', {})).code, 405);
    assert.equal((await call('references-settings', 'PATCH', { enabled: true, videos: [{ url: 'https://evil.test' }], updated_at: settings.updated_at }, true)).code, 400);
    assert.equal(writes, 0);
    assert.equal((await call('references-settings', 'PATCH', { enabled: false, videos, updated_at: '2026-09-20T12:00:00Z' }, true)).code, 409);
    const saved = await call('references-settings', 'PATCH', { enabled: false, videos, updated_at: settings.updated_at }, true);
    assert.equal(saved.code, 200);
    assert.equal(saved.data.settings.videos.length, 9);
    assert.deepEqual((await call('references-public')).data, { enabled: false, videos: [], total: 0 });
    assert.equal((await call('references-thumbnail', 'GET', null, false, { id: '00000000000' })).code, 404);
  } finally {
    globalThis.fetch = original;
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});
