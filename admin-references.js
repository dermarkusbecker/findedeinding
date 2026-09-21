import { normalizeReferences, youtubeVideoId } from './lib/references.js';

const form = document.querySelector('#referencesForm');
const list = document.querySelector('#referenceEditorList');
const status = document.querySelector('#referencesStatus');
const fieldset = form.querySelector('fieldset');
const input = document.querySelector('#referenceNewUrl');
let settings = null;
let videos = [];
let dirty = false;
let loading = false;
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const announce = (message, error = false) => { status.textContent = message; status.dataset.error = String(error); };
const changed = () => { dirty = true; announce('Ungespeicherte Änderungen. Mit „Referenzen speichern“ veröffentlichen.'); };

async function request(action, options) {
  const response = await fetch(`/api/leads?action=${action}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Referenzen konnten nicht geladen werden.');
  return data;
}

function render() {
  list.innerHTML = videos.length ? videos.map((video, index) => `<article class="reference-editor-row" data-reference-index="${index}"><div class="reference-editor-preview"><img src="https://i.ytimg.com/vi/${video.id}/hqdefault.jpg" alt="Video-Vorschau ${index + 1}" loading="lazy" referrerpolicy="no-referrer"><span>${index < 6 ? 'Landingpage + Referenzen' : 'Alle Referenzen'}</span></div><div class="reference-editor-fields"><strong>Video ${index + 1}</strong><label>YouTube-Link<input type="url" value="${escape(video.url)}" data-reference-url required></label><label>Überschrift <small>(optional)</small><input value="${escape(video.title)}" maxlength="180" data-reference-title placeholder="Erfahrungen mit Finde dein Ding"></label></div><div class="reference-editor-actions"><button class="secondary" type="button" data-reference-action="up" ${index === 0 ? 'disabled' : ''} aria-label="Video ${index + 1} nach oben">↑</button><button class="secondary" type="button" data-reference-action="down" ${index === videos.length - 1 ? 'disabled' : ''} aria-label="Video ${index + 1} nach unten">↓</button><button class="secondary" type="button" data-reference-action="remove" aria-label="Video ${index + 1} entfernen">Entfernen</button></div></article>`).join('') : '<p class="empty">Noch keine Referenzen. Füge deinen ersten YouTube-Link hinzu.</p>';
  document.querySelector('#referencesCount').textContent = `${videos.length} Videos · ${Math.min(6, videos.length)} auf der Landingpage`;
  list.querySelectorAll('img').forEach(image => image.addEventListener('error', () => { image.hidden = true; }));
}

async function load(force = false) {
  if (loading || (settings && !force)) return;
  loading = true;
  fieldset.disabled = true;
  announce('Referenzen werden geladen …');
  try {
    const data = await request('references-settings');
    settings = data.settings;
    videos = settings.videos.map(video => ({ ...video }));
    form.elements.enabled.checked = settings.enabled;
    dirty = false;
    render();
    announce(settings.enabled ? 'Referenzen sind veröffentlicht.' : 'Referenzen sind ausgeblendet. Gespeicherte Videos bleiben erhalten.');
  } catch (error) { announce(error.message, true); }
  finally { loading = false; fieldset.disabled = !settings; }
}

window.loadReferenceSettings = load;
document.querySelector('#referencesReload').addEventListener('click', () => {
  if (dirty && !confirm('Ungespeicherte Änderungen verwerfen und neu laden?')) return;
  load(true);
});
form.elements.enabled.addEventListener('change', changed);

list.addEventListener('input', event => {
  const row = event.target.closest('[data-reference-index]');
  if (!row) return;
  const video = videos[Number(row.dataset.referenceIndex)];
  if (event.target.matches('[data-reference-title]')) video.title = event.target.value;
  if (event.target.matches('[data-reference-url]')) {
    video.url = event.target.value;
    const id = youtubeVideoId(video.url);
    event.target.setCustomValidity(id ? '' : 'Bitte einen gültigen YouTube-Video-Link eingeben.');
    if (id) { video.id = id; const image = row.querySelector('img'); image.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; image.hidden = false; }
  }
  changed();
});
list.addEventListener('click', event => {
  const button = event.target.closest('[data-reference-action]');
  if (!button) return;
  const index = Number(button.closest('[data-reference-index]').dataset.referenceIndex);
  const action = button.dataset.referenceAction;
  if (action === 'remove') videos.splice(index, 1);
  else { const other = index + (action === 'up' ? -1 : 1); [videos[index], videos[other]] = [videos[other], videos[index]]; }
  changed(); render();
  list.querySelector(`[data-reference-index="${Math.min(index, videos.length - 1)}"] button:not(:disabled)`)?.focus();
});

async function add() {
  const id = youtubeVideoId(input.value);
  if (!id) { input.setCustomValidity('Bitte einen gültigen YouTube-Video-Link eingeben.'); input.reportValidity(); return; }
  if (videos.some(video => video.id === id)) { announce('Dieses Video ist bereits in der Liste.', true); return; }
  fieldset.disabled = true;
  announce('Video wird vorbereitet …');
  try {
    const data = await request(`references-preview&url=${encodeURIComponent(input.value.trim())}`);
    videos.push(data.video); input.value = ''; changed(); render();
  } catch (error) { announce(error.message, true); }
  finally { fieldset.disabled = false; input.focus(); }
}
input.addEventListener('input', () => input.setCustomValidity(''));
input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); add(); } });
document.querySelector('#referenceAdd').addEventListener('click', add);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!settings) return;
  if (input.value.trim()) { announce('Bitte den eingegebenen Link zuerst mit „Video hinzufügen“ übernehmen.', true); input.focus(); return; }
  let payload;
  try { payload = normalizeReferences({ enabled: form.elements.enabled.checked, videos }); }
  catch (error) { announce(error.message, true); return; }
  fieldset.disabled = true;
  announce('Referenzen werden gespeichert …');
  try {
    const data = await request('references-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, updated_at: settings.updated_at }) });
    settings = data.settings; videos = settings.videos.map(video => ({ ...video })); dirty = false; render();
    announce(settings.enabled ? 'Gespeichert und veröffentlicht. Die Landingpage zeigt die ersten sechs Videos.' : 'Gespeichert. Referenzen und Navigationspunkt sind ausgeblendet.');
  } catch (error) { announce(error.message, true); }
  finally { fieldset.disabled = false; }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
if (document.querySelector('[data-settings-panel="references"]').classList.contains('active')) load();
