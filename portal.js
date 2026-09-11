import { journeyStepStatuses, weekOnePrompt } from './lib/week-one.js';
import { currentGuidedStep, guidedClarityStep, guidedStepStatuses, guidedWeekDefinition, MOTIVATOR_OPTIONS, needsGuidedClarityCheckin } from './lib/guided-weeks.js';
import { buildProgressCelebration } from './lib/progress-celebration.js';

const previewUrl = new URL(window.location.href);
const suppliedAdminPreviewToken = previewUrl.searchParams.get('adminPreview') || '';
if (suppliedAdminPreviewToken) sessionStorage.setItem('fdd_admin_preview_token', suppliedAdminPreviewToken);
const adminPreviewToken = suppliedAdminPreviewToken || sessionStorage.getItem('fdd_admin_preview_token') || '';
const adminPreviewMode = Boolean(adminPreviewToken);
if (suppliedAdminPreviewToken) {
  previewUrl.searchParams.delete('adminPreview');
  history.replaceState(null, '', `${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`);
}
document.body.classList.toggle('admin-preview-active', adminPreviewMode);
document.querySelector('#adminPreviewBar')?.classList.toggle('hidden', !adminPreviewMode);

const resolveSpeechRecognition = (windowObject = window) => {
  if (!windowObject) return null;
  return windowObject.SpeechRecognition || windowObject.webkitSpeechRecognition || null;
};

const applySpeechTranscript = (existingValue = '', newText = '') => {
  const text = String(newText || '').trim();
  if (!text) return String(existingValue || '');
  const current = String(existingValue || '').trimEnd();
  return current ? `${current} ${text}` : text;
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const lockedNonOnboardingViews = ['journey', 'insights', 'documents', 'support'];
const rawLocal = JSON.parse(localStorage.getItem('fdd_customer_notes') || '{}');
const local = { ...rawLocal, answers: rawLocal.answers || {}, uploads: rawLocal.uploads || {}, support: rawLocal.support || [], drafts: rawLocal.drafts || {} };
let program = null;
let customerWorkspace = null;
let currentWeek = 1;
let currentContent = null;
let initialViewResolved = false;
let todayMode = 'dashboard';
let journeyMessages = [];
let journeyLoading = false;
let claraEntranceLoading = false;
let claraCurrentPrompt = '';
let claraStepTransition = null;
let claraStepTransitionTimer = null;
let claraTurnStartedAt = 0;
const CLARA_TYPING_MINIMUM_MS = 850;
let pendingClarityWeek = null;
let selectedClarityScore = null;
let draftSaveTimer = null;
let pendingWeekAction = null;
let onboardingProfileDirty = false;
let onboardingProfileSaveTimer = null;
let onboardingProfileRevision = 0;
let onboardingProfilePersistedRevision = 0;
let onboardingProfileSaveQueue = Promise.resolve();
let privacyPreviewTimer = null;
let privacyPreviewController = null;
let privacyPreviewObjectUrl = '';
let commitmentPreviewTimer = null;
let commitmentPreviewController = null;
let commitmentPreviewObjectUrl = '';
const onboardingFormDraftTimers = new Map();
const onboardingFormDraftQueues = new Map();
const onboardingFormsFinalizing = new Set();
const speechState = { recognition: null, activeButton: null };

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function syncClaraTypingState() {
  const activeWeek = $('#activeWeek');
  const entryTyping = $('#claraEntryTyping');
  if (!activeWeek || !entryTyping) return;
  const chatIsVisible = !$('#claraJourney')?.classList.contains('hidden');
  activeWeek.classList.toggle('clara-is-typing', claraEntranceLoading);
  activeWeek.setAttribute('aria-busy', String(claraEntranceLoading || journeyLoading));
  entryTyping.classList.toggle('hidden', !claraEntranceLoading || chatIsVisible);
}

function beginClaraTurn({ deferTimer = false } = {}) {
  claraEntranceLoading = true;
  claraTurnStartedAt = deferTimer ? 0 : nowMs();
  syncClaraTypingState();
  renderClaraJourney();
}

async function waitForClaraTyping(startedAt = claraTurnStartedAt) {
  const elapsed = nowMs() - (startedAt || nowMs());
  const remaining = Math.max(0, CLARA_TYPING_MINIMUM_MS - elapsed);
  if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function finishClaraTurn() {
  claraEntranceLoading = false;
  syncClaraTypingState();
  renderClaraJourney();
}

function saveLocal() { localStorage.setItem('fdd_customer_notes', JSON.stringify(local)); }
function toast(message) { const el = $('#portalToast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function showView(name) {
  const isLockedView = !program?.onboardingComplete && lockedNonOnboardingViews.includes(name);
  const safeName = name;
  const targetPanel = safeName === 'onboarding' ? 'today' : safeName;
  $$('.screen').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === targetPanel));
  $$('aside nav button').forEach((button) => {
    const isThisLockedView = !program?.onboardingComplete && lockedNonOnboardingViews.includes(button.dataset.view);
    button.classList.toggle('active', button.dataset.view === safeName);
    button.classList.toggle('locked', isThisLockedView);
    button.title = isThisLockedView ? 'Bitte zuerst das Onboarding abschließen.' : '';
  });
  if (isLockedView) {
    toast('Bitte zuerst das Onboarding abschließen, um diesen Bereich zu bearbeiten.');
  }
  if (program) render();
  if (name === 'appointments') renderPortalAppointments();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setSpeechButtonState(button, isListening) {
  if (!button) return;
  button.classList.toggle('listening', isListening);
  button.setAttribute('aria-pressed', String(isListening));
  button.textContent = isListening ? '⏹ Spracheingabe stoppen' : button.dataset.defaultLabel || '⌁ Spracheingabe';
}

function wireSpeechControls() {
  document.querySelectorAll('.voice').forEach((button) => {
    if (!button.dataset.boundSpeech) {
      button.type = 'button';
      button.dataset.boundSpeech = 'true';
      attachSpeechButton(button);
    }
  });
}

function attachSpeechButton(button) {
  if (!button) return;
  button.dataset.defaultLabel = button.dataset.defaultLabel || button.textContent.trim();
  const target = button.dataset.target ? document.getElementById(button.dataset.target) : button.closest('form')?.querySelector('textarea, input');
  if (!target) return;

  button.addEventListener('click', () => {
    const Recognition = resolveSpeechRecognition(window);
    if (!Recognition) {
      toast('Dein Browser unterstützt Spracheingabe leider nicht.');
      return;
    }

    if (speechState.recognition && speechState.activeButton === button) {
      speechState.recognition.stop();
      speechState.recognition = null;
      speechState.activeButton = null;
      setSpeechButtonState(button, false);
      return;
    }

    if (speechState.recognition) {
      speechState.recognition.stop();
      speechState.recognition = null;
      if (speechState.activeButton) setSpeechButtonState(speechState.activeButton, false);
      speechState.activeButton = null;
    }

    const recognition = new Recognition();
    recognition.lang = 'de-DE';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setSpeechButtonState(button, true);
      speechState.activeButton = button;
      speechState.recognition = recognition;
    };

    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (!finalText) return;
      target.value = applySpeechTranscript(target.value, finalText);
      target.focus();
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };

    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed' ? 'Microfonzugriff wurde verweigert. Bitte erlauben.' : 'Spracheingabe konnte nicht gestartet werden.';
      toast(message);
      setSpeechButtonState(button, false);
      speechState.activeButton = null;
      speechState.recognition = null;
    };

    recognition.onend = () => {
      setSpeechButtonState(button, false);
      if (speechState.activeButton === button) {
        speechState.activeButton = null;
      }
      if (speechState.recognition === recognition) {
        speechState.recognition = null;
      }
    };

    try {
      recognition.start();
    } catch (error) {
      toast('Spracheingabe ist bereits aktiv. Bitte warte kurz und versuche es erneut.');
      setSpeechButtonState(button, false);
      speechState.activeButton = null;
      speechState.recognition = null;
    }
  });
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.view === 'today') todayMode = 'dashboard';
  showView(button.dataset.view);
}));
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewLink)));
wireSpeechControls();
window.wireSpeechControls = wireSpeechControls;

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (adminPreviewToken) headers.Authorization = `Bearer ${adminPreviewToken}`;
  const response = await fetch(url, { ...options, headers });
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = {}; }
  if (!response.ok) { const error = new Error(data.error || 'Die Anfrage konnte nicht verarbeitet werden.'); error.status = response.status; error.data = data; throw error; }
  return data;
}

function adminPreviewUrl(url) {
  if (!adminPreviewToken) return url;
  const target = new URL(url, window.location.origin);
  target.searchParams.set('adminPreview', adminPreviewToken);
  return `${target.pathname}${target.search}${target.hash}`;
}

function downloadCustomerDocument(documentId, fileName = 'Finde-Dein-Ding-Dokument.pdf') {
  if (!documentId) return;
  const anchor = document.createElement('a');
  anchor.href = adminPreviewUrl(`/api/customer-records?action=document-download&download=1&documentId=${encodeURIComponent(documentId)}`);
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function ensureDocumentPreviewDialog() {
  let dialog = $('#documentPreviewDialog');
  if (dialog) return dialog;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="documentPreviewDialog" class="document-preview-dialog" aria-labelledby="documentPreviewTitle">
      <div class="document-preview-shell">
        <header><div><p class="eyebrow">Deine Dokumentenakte</p><h2 id="documentPreviewTitle">Dokument ansehen</h2><p id="documentPreviewMeta">Sicher und schreibgeschützt geöffnet.</p></div><button type="button" data-close-document-preview aria-label="Dokumentenvorschau schließen">×</button></header>
        <div class="document-preview-stage"><iframe id="documentPreviewFrame" title="Dokumentenvorschau" hidden></iframe><img id="documentPreviewImage" alt="" hidden><video id="documentPreviewVideo" controls playsinline hidden></video><div id="documentPreviewFallback" class="document-preview-fallback" hidden><span>▤</span><strong>Für dieses Dateiformat ist keine direkte Vorschau verfügbar.</strong><p>Du kannst die Originaldatei sicher herunterladen und auf deinem Gerät öffnen.</p></div></div>
        <footer><button class="secondary" type="button" data-close-document-preview>Schließen</button><a class="primary" id="downloadPreviewDocument" href="#" download>Dokument herunterladen ↓</a></footer>
      </div>
    </dialog>`);
  dialog = $('#documentPreviewDialog');
  dialog.querySelectorAll('[data-close-document-preview]').forEach((button) => button.addEventListener('click', closeDocumentPreview));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDocumentPreview(); });
  dialog.addEventListener('close', clearDocumentPreview);
  return dialog;
}

function clearDocumentPreview() {
  const frame = $('#documentPreviewFrame');
  const image = $('#documentPreviewImage');
  const video = $('#documentPreviewVideo');
  if (frame) frame.src = 'about:blank';
  if (image) image.removeAttribute('src');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
}

function closeDocumentPreview() {
  const dialog = $('#documentPreviewDialog');
  if (dialog?.open) dialog.close();
}

function openDocumentPreview({ id, title, fileName, mimeType }) {
  if (!id) return;
  const dialog = ensureDocumentPreviewDialog();
  const viewUrl = adminPreviewUrl(`/api/customer-records?action=document-download&documentId=${encodeURIComponent(id)}`);
  const downloadUrl = adminPreviewUrl(`/api/customer-records?action=document-download&download=1&documentId=${encodeURIComponent(id)}`);
  const normalizedMime = String(mimeType || '').toLowerCase();
  const normalizedFile = String(fileName || '').toLowerCase();
  const isPdf = normalizedMime === 'application/pdf' || normalizedFile.endsWith('.pdf');
  const isImage = normalizedMime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(normalizedFile);
  const isVideo = normalizedMime.startsWith('video/') || /\.(webm|mp4|mov)$/.test(normalizedFile);
  const frame = $('#documentPreviewFrame'), image = $('#documentPreviewImage'), video = $('#documentPreviewVideo'), fallback = $('#documentPreviewFallback');
  [frame, image, video, fallback].forEach((element) => { element.hidden = true; });
  $('#documentPreviewTitle').textContent = title || fileName || 'Dokument ansehen';
  $('#documentPreviewMeta').textContent = [fileName, isPdf ? 'PDF-Dokument' : isImage ? 'Bilddatei' : isVideo ? 'Videodatei' : 'Originaldatei'].filter(Boolean).join(' · ');
  $('#downloadPreviewDocument').href = downloadUrl;
  $('#downloadPreviewDocument').download = fileName || 'Finde-Dein-Ding-Dokument';
  if (isPdf) { frame.hidden = false; frame.src = `${viewUrl}#view=FitH`; }
  else if (isImage) { image.hidden = false; image.src = viewUrl; image.alt = title || fileName || 'Dokumentenvorschau'; }
  else if (isVideo) { video.hidden = false; video.src = viewUrl; }
  else fallback.hidden = false;
  dialog.showModal();
}

function modeLabel() { return 'Automatische Freischaltung alle sieben Tage'; }


function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const onboardingCountryCodes = 'DE AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK'.split(' ');

function populateOnboardingCountries(selected = 'Deutschland') {
  const select = $('#onboardingCountry');
  if (!select) return;
  let displayNames = null;
  try { displayNames = new Intl.DisplayNames(['de'], { type: 'region' }); } catch {}
  const names = onboardingCountryCodes.map((code) => {
    if (code === 'DE') return 'Deutschland';
    try {
      return displayNames?.of(code) || (code === 'XK' ? 'Kosovo' : code);
    } catch {
      return code === 'XK' ? 'Kosovo' : code;
    }
  });
  const uniqueNames = [...new Set(names.filter(Boolean))].filter((name) => name !== 'Deutschland').sort((a, b) => a.localeCompare(b, 'de'));
  if (selected && selected !== 'Deutschland' && !uniqueNames.includes(selected)) uniqueNames.unshift(selected);
  select.replaceChildren(...['Deutschland', ...uniqueNames].map((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }));
  select.value = selected || 'Deutschland';
}

function validOnboardingBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function setOnboardingBirthDate(value = '') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  $('#onboardingBirthDay').value = match?.[3] || '';
  $('#onboardingBirthMonth').value = match?.[2] || '';
  $('#onboardingBirthYear').value = match?.[1] || '';
  $('#onboardingBirthDate').value = match ? value : '';
}

function syncOnboardingBirthDate() {
  const day = $('#onboardingBirthDay').value.padStart(2, '0');
  const month = $('#onboardingBirthMonth').value.padStart(2, '0');
  const year = $('#onboardingBirthYear').value;
  const value = `${year}-${month}-${day}`;
  $('#onboardingBirthDate').value = validOnboardingBirthDate(value) ? value : '';
  return $('#onboardingBirthDate').value;
}

function onboardingProfilePayload() {
  return {
    name: $('#onboardingName').value.trim(),
    email: $('#onboardingEmail').value.trim().toLowerCase(),
    birthDate: $('#onboardingBirthDate').value,
    street: $('#onboardingStreet').value.trim(),
    postalCode: $('#onboardingPostalCode').value.trim(),
    city: $('#onboardingCity').value.trim(),
    country: $('#onboardingCountry').value.trim(),
    phone: $('#onboardingPhone').value.trim(),
    mobilePhone: $('#onboardingMobilePhone').value.trim(),
    preferredChannel: $('#onboardingPreferredChannel').value,
    whatsappSameAsMobile: true,
  };
}

function onboardingProfileMissingFields() {
  const profile = onboardingProfilePayload();
  const requirements = [
    ['name', 'Vor- und Nachname', Boolean(profile.name)],
    ['email', 'gültige E-Mail-Adresse', /^\S+@\S+\.\S+$/.test(profile.email)],
    ['birthDate', 'Geburtsdatum', validOnboardingBirthDate(profile.birthDate)],
    ['street', 'Straße und Hausnummer', Boolean(profile.street)],
    ['postalCode', 'Postleitzahl', Boolean(profile.postalCode)],
    ['city', 'Ort', Boolean(profile.city)],
    ['country', 'Land', Boolean(profile.country)],
    ['mobilePhone', 'Mobilnummer', Boolean(profile.mobilePhone)],
  ];
  return requirements.filter(([, , complete]) => !complete).map(([key, label]) => ({ key, label }));
}

function markOnboardingProfileFields(missing = onboardingProfileMissingFields()) {
  const missingKeys = new Set(missing.map((item) => item.key));
  $$('[data-profile-field]').forEach((field) => field.classList.toggle('field-missing', missingKeys.has(field.dataset.profileField)));
  for (const { key } of missing) document.querySelector(`[data-profile-field="${key}"] input, [data-profile-field="${key}"] select`)?.setAttribute('aria-invalid', 'true');
  $$('[data-profile-field]:not(.field-missing) input, [data-profile-field]:not(.field-missing) select').forEach((control) => control.removeAttribute('aria-invalid'));
  return missing;
}

function profileFormComplete() {
  return onboardingProfileMissingFields().length === 0;
}

function setGateStatus(id, complete, openLabel = 'Offen') {
  const status = $(id);
  if (!status) return;
  status.textContent = complete ? 'Erledigt ✓' : openLabel;
  status.classList.toggle('complete', complete);
}

function refreshOnboardingGateState() {
  const completed = Boolean(program?.onboardingComplete);
  const privacyChecked = completed || Boolean(program?.onboarding?.privacyConfirmed);
  const profileReady = completed || (Boolean(program?.onboarding?.profileComplete) && !onboardingProfileDirty);
  const commitmentConfirmed = completed || Boolean(program?.onboarding?.commitmentConfirmed || program?.onboarding?.commitmentDocumentId);
  $('#privacy').checked = privacyChecked;
  setGateStatus('#profileGateStatus', profileReady, onboardingProfileDirty ? 'Speichern' : 'Offen');
  setGateStatus('#privacyGateStatus', privacyChecked);
  setGateStatus('#commitmentGateStatus', commitmentConfirmed);
  $('#startProcess').disabled = !profileReady || !privacyChecked || !commitmentConfirmed;
}

function renderOnboardingState(completed = false) {
  const profile = program?.profile || {};
  $('.onboarding-welcome .clara-copy').innerHTML = '<p>Ich bin Clara. Ich stelle dir eine Frage nach der anderen und helfe dir, deine Gedanken zu ordnen. Du antwortest ehrlich – den Rest entwickeln wir gemeinsam.</p>';
  $('.onboarding-welcome .promise strong').textContent = 'Du brauchst noch keine fertigen Antworten. Wir starten einfach mit dem nächsten ehrlichen Schritt.';
  if (!onboardingProfileDirty) {
    $('#onboardingName').value = profile.name || '';
    $('#onboardingEmail').value = profile.email || '';
    setOnboardingBirthDate(profile.birthDate || '');
    $('#onboardingStreet').value = profile.street || '';
    $('#onboardingPostalCode').value = profile.postalCode || '';
    $('#onboardingCity').value = profile.city || '';
    populateOnboardingCountries(profile.country || 'Deutschland');
    $('#onboardingPhone').value = profile.phone || '';
    $('#onboardingMobilePhone').value = profile.mobilePhone || '';
    $('#onboardingPreferredChannel').value = profile.preferredChannel || 'email';
  }
  const missing = program?.onboarding?.missingProfileFields || [];
  $('#profileGateHint').textContent = completed
    ? 'Diese Angaben sind Bestandteil deiner abgeschlossenen Kundenakte.'
    : missing.length ? `Bitte noch ergänzen: ${missing.join(', ')}.` : onboardingProfileDirty ? 'Änderungen noch speichern.' : 'Alle Pflichtangaben sind vollständig gespeichert.';
  $('#profileGateHint').classList.toggle('complete', !missing.length && !onboardingProfileDirty);
  $$('#onboardingProfileForm input, #onboardingProfileForm select').forEach((control) => { control.disabled = completed; });
  if (!completed) markOnboardingProfileFields();
  $('#saveOnboardingProfile').classList.toggle('hidden', completed);

  const privacyConfirmed = Boolean(program?.onboarding?.privacyConfirmed);
  const confirmedAt = program?.onboarding?.privacyConfirmedAt;
  $('.privacy-gate-card').classList.toggle('is-confirmed', privacyConfirmed);
  $('#privacyConsentStatus').textContent = privacyConfirmed
    ? `Digital bestätigt${confirmedAt ? ` am ${new Date(confirmedAt).toLocaleDateString('de-DE')}` : ''}.${program?.onboarding?.privacyDocumentId ? ' Das ausgefüllte Dokument liegt unter „Dokumente“ bereit.' : ''}`
    : 'Noch nicht bestätigt.';
  $('#openPrivacyConsent').textContent = privacyConfirmed ? 'Bestätigtes Formular ansehen →' : 'Formular ansehen & Einwilligung ausfüllen →';
  renderCommitmentState(completed);
  refreshOnboardingGateState();
}

function renderCommitmentState(completed = false) {
  const status = $('#signedCommitmentStatus');
  if (!status) return;
  const confirmed = completed || Boolean(program?.onboarding?.commitmentConfirmed || program?.onboarding?.commitmentDocumentId);
  const confirmedAt = program?.onboarding?.commitmentConfirmedAt;
  $('.commitment-card').classList.toggle('is-confirmed', confirmed);
  status.textContent = confirmed
    ? `Digital bestätigt${confirmedAt ? ` am ${new Date(confirmedAt).toLocaleDateString('de-DE')}` : ''}. Das ausgefüllte PDF liegt unter „Dokumente“ bereit.`
    : 'Noch nicht digital ausgefüllt und bestätigt.';
  $('#openCommitment').textContent = confirmed ? 'Bestätigtes Commitment ansehen →' : 'Commitment öffnen & ausfüllen →';
}

function privacyDocumentHref() {
  const documentId = program?.onboarding?.privacyDocumentId;
  return adminPreviewUrl(documentId
    ? `/api/customer-records?action=document-download&documentId=${encodeURIComponent(documentId)}`
    : '/api/participant-program?feature=privacy-template');
}

function currentPrivacyConsentInput() {
  return {
    specialCategories: $('#privacySpecialCategories').checked,
    privacyNotice: $('#privacyNoticeAccepted').checked,
    aiNotice: $('#privacyAiAccepted').checked,
    name: $('#privacyName').value.trim(),
    place: $('#privacyPlace').value.trim(),
    date: $('#privacyDate').value,
  };
}

function onboardingDraftStatus(formKey) {
  const commitment = formKey === 'start_commitment';
  const form = $(commitment ? '#commitmentForm' : '#privacyConsentForm');
  const id = commitment ? 'commitmentDraftStatus' : 'privacyDraftStatus';
  let status = $(`#${id}`);
  if (!status) {
    status = document.createElement('p');
    status.id = id;
    status.className = 'onboarding-form-autosave';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = commitment ? 'Deine Antworten werden automatisch zwischengespeichert.' : 'Deine Eingaben werden automatisch zwischengespeichert.';
    form.prepend(status);
  }
  return status;
}

function queueOnboardingFormDraft(formKey, draft) {
  if (onboardingFormsFinalizing.has(formKey)) return;
  window.clearTimeout(onboardingFormDraftTimers.get(formKey));
  const status = onboardingDraftStatus(formKey);
  status.textContent = 'Wird automatisch zwischengespeichert …';
  status.classList.remove('saved', 'failed');
  onboardingFormDraftTimers.set(formKey, window.setTimeout(() => {
    const previous = onboardingFormDraftQueues.get(formKey) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => request('/api/participant-program', {
      method: 'PATCH', body: JSON.stringify({ action: 'save_onboarding_form_draft', formKey, draft }),
    })).then((result) => {
      if (program?.onboarding) {
        program.onboarding.formDrafts ||= {};
        program.onboarding.formDrafts[formKey] = result.draft || draft;
      }
      const savedAt = result.savedAt ? new Date(result.savedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
      status.textContent = `✓ Automatisch zwischengespeichert${savedAt ? ` · ${savedAt} Uhr` : ''}`;
      status.classList.add('saved');
      return result;
    }).catch((error) => {
      status.textContent = `Zwischenspeichern fehlgeschlagen: ${error.message}`;
      status.classList.add('failed');
    });
    onboardingFormDraftQueues.set(formKey, next);
  }, 650));
}

async function prepareOnboardingFormFinalization(formKey) {
  onboardingFormsFinalizing.add(formKey);
  window.clearTimeout(onboardingFormDraftTimers.get(formKey));
  await (onboardingFormDraftQueues.get(formKey) || Promise.resolve());
}

async function updatePrivacyPdfPreview() {
  window.clearTimeout(privacyPreviewTimer);
  privacyPreviewController?.abort();
  const controller = new AbortController();
  privacyPreviewController = controller;
  const status = $('#privacyPreviewStatus');
  status.textContent = 'Live-Vorschau wird aktualisiert …';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPreviewToken) headers.Authorization = `Bearer ${adminPreviewToken}`;
    const response = await fetch(adminPreviewUrl('/api/participant-program?feature=privacy-preview'), {
      method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ consent: currentPrivacyConsentInput() }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Die Live-Vorschau konnte nicht erstellt werden.');
    }
    const nextUrl = URL.createObjectURL(await response.blob());
    const previousUrl = privacyPreviewObjectUrl;
    privacyPreviewObjectUrl = nextUrl;
    $('#privacyPdfPreview').src = `${nextUrl}#view=FitH`;
    $('#privacyPdfExternal').href = nextUrl;
    status.textContent = '✓ Eingaben oben in der PDF aktualisiert';
    if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
  } catch (error) {
    if (error.name !== 'AbortError') status.textContent = error.message;
  } finally {
    if (privacyPreviewController === controller) privacyPreviewController = null;
  }
}

function schedulePrivacyPdfPreview() {
  window.clearTimeout(privacyPreviewTimer);
  privacyPreviewTimer = window.setTimeout(updatePrivacyPdfPreview, 280);
}

function openPrivacyConsentDialog() {
  const confirmed = Boolean(program?.onboarding?.privacyConfirmed);
  const details = program?.onboarding?.privacyDetails || {};
  const href = privacyDocumentHref();
  $('#privacyPdfPreview').src = `${href}#view=FitH`;
  $('#privacyPdfExternal').href = href;
  $('#privacyConsentForm').classList.toggle('hidden', confirmed);
  $('#privacyReadonlyState').classList.toggle('hidden', !confirmed);
  if (confirmed) {
    const date = program?.onboarding?.privacyConfirmedAt ? new Date(program.onboarding.privacyConfirmedAt).toLocaleString('de-DE') : 'gespeichertem Datum';
    $('#privacyReadonlyCopy').textContent = `Bestätigt von ${details.name || program.profile?.name || 'dir'} am ${date}${details.place ? ` in ${details.place}` : ''}. Das ausgefüllte PDF ist schreibgeschützt hinterlegt.`;
  } else {
    onboardingFormsFinalizing.delete('privacy_consent');
    const draft = program?.onboarding?.formDrafts?.privacy_consent || {};
    $('#privacySpecialCategories').checked = draft.specialCategories === true;
    $('#privacyNoticeAccepted').checked = draft.privacyNotice === true;
    $('#privacyAiAccepted').checked = draft.aiNotice === true;
    $('#privacyName').value = draft.name || $('#onboardingName').value || program?.profile?.name || '';
    $('#privacyPlace').value = draft.place || $('#onboardingCity').value || program?.profile?.city || '';
    const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const datePart = (type) => dateParts.find((part) => part.type === type)?.value;
    $('#privacyDate').value = draft.date || `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
    onboardingDraftStatus('privacy_consent');
  }
  $('#privacyConsentDialog').showModal();
  if (!confirmed) updatePrivacyPdfPreview();
}

function closePrivacyConsentDialog(result = '') {
  const dialog = $('#privacyConsentDialog');
  if (!dialog) return;
  window.clearTimeout(privacyPreviewTimer);
  privacyPreviewController?.abort();
  privacyPreviewController = null;
  if (dialog.open) dialog.close(result);
  dialog.removeAttribute('open');
}

function commitmentDocumentHref() {
  const documentId = program?.onboarding?.commitmentDocumentId;
  return adminPreviewUrl(documentId
    ? `/api/customer-records?action=document-download&documentId=${encodeURIComponent(documentId)}`
    : '/api/participant-program?feature=commitment-template');
}

function currentCommitmentInput() {
  return {
    name: $('#commitmentName').value.trim(),
    startDate: $('#commitmentStartDate').value,
    why: $('#commitmentWhy').value.trim(),
    change: $('#commitmentChange').value.trim(),
    costOfUnclarity: $('#commitmentCost').value.trim(),
    place: $('#commitmentPlace').value.trim(),
    signatureDate: $('#commitmentSignatureDate').value,
    accepted: $('#commitmentAccepted').checked,
    wizardStep: commitmentWizardStep,
  };
}

function commitmentPreviewStatus() {
  let status = $('#commitmentPreviewStatus');
  if (status) return status;
  status = document.createElement('span');
  status.id = 'commitmentPreviewStatus';
  status.className = 'commitment-preview-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Schreibgeschützte Live-Vorschau bereit';
  $('#commitmentPdfExternal').before(status);
  return status;
}

async function updateCommitmentPdfPreview() {
  window.clearTimeout(commitmentPreviewTimer);
  commitmentPreviewController?.abort();
  const controller = new AbortController();
  commitmentPreviewController = controller;
  const status = commitmentPreviewStatus();
  status.textContent = 'Live-Vorschau wird aktualisiert …';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (adminPreviewToken) headers.Authorization = `Bearer ${adminPreviewToken}`;
    const response = await fetch(adminPreviewUrl('/api/participant-program?feature=commitment-preview'), {
      method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ commitment: currentCommitmentInput() }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Die Commitment-Vorschau konnte nicht erstellt werden.');
    }
    const nextUrl = URL.createObjectURL(await response.blob());
    const previousUrl = commitmentPreviewObjectUrl;
    commitmentPreviewObjectUrl = nextUrl;
    $('#commitmentPdfPreview').src = `${nextUrl}#view=FitH`;
    $('#commitmentPdfExternal').href = nextUrl;
    status.textContent = '✓ Deine Eingaben stehen jetzt im PDF';
    if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
  } catch (error) {
    if (error.name !== 'AbortError') status.textContent = error.message;
  } finally {
    if (commitmentPreviewController === controller) commitmentPreviewController = null;
  }
}

function scheduleCommitmentPdfPreview() {
  window.clearTimeout(commitmentPreviewTimer);
  commitmentPreviewTimer = window.setTimeout(updateCommitmentPdfPreview, 280);
}

function todayInBerlin() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

let commitmentWizardStep = 0;

function commitmentStepControls(step = commitmentWizardStep) {
  return [...document.querySelectorAll(`[data-commitment-step="${step}"] input, [data-commitment-step="${step}"] textarea`)];
}

function validateCommitmentStep(step = commitmentWizardStep) {
  const invalid = commitmentStepControls(step).find((control) => !control.checkValidity());
  if (invalid) invalid.reportValidity();
  return !invalid;
}

function renderCommitmentReview() {
  $('#commitmentReview').innerHTML = [
    ['Warum ich hier bin', $('#commitmentWhy').value.trim()],
    ['Was ich verändern möchte', $('#commitmentChange').value.trim()],
    ['Was mich weitere Unklarheit kostet', $('#commitmentCost').value.trim()],
  ].map(([label, value]) => `<article><small>${escapeHtml(label)}</small><p>${escapeHtml(value)}</p></article>`).join('');
}

function renderCommitmentWizard() {
  $$('.commitment-step').forEach((step, index) => {
    const active = index === commitmentWizardStep;
    step.hidden = !active;
    step.classList.toggle('active', active);
    step.querySelectorAll('input, textarea').forEach((control) => { control.disabled = !active; });
  });
  $$('#commitmentWizardProgress li').forEach((item, index) => {
    item.classList.toggle('active', index === commitmentWizardStep);
    item.classList.toggle('complete', index < commitmentWizardStep);
  });
  $('#commitmentBack').hidden = commitmentWizardStep === 0;
  $('#commitmentNext').hidden = commitmentWizardStep === 4;
  $('#confirmCommitment').hidden = commitmentWizardStep !== 4;
  $('#commitmentStepStatus').textContent = `Schritt ${commitmentWizardStep + 1} von 5`;
  if (commitmentWizardStep === 4) renderCommitmentReview();
}

function openCommitmentDialog() {
  const confirmed = Boolean(program?.onboarding?.commitmentConfirmed || program?.onboarding?.commitmentDocumentId);
  const details = program?.onboarding?.commitmentDetails || {};
  const href = commitmentDocumentHref();
  $('#commitmentPdfPreview').src = `${href}#view=FitH`;
  $('#commitmentPdfExternal').href = href;
  $('#openCompletedCommitment').href = href;
  const previewStatus = commitmentPreviewStatus();
  $('#commitmentForm').classList.toggle('hidden', confirmed);
  $('#commitmentReadonlyState').classList.toggle('hidden', !confirmed);
  if (confirmed) {
    previewStatus.textContent = '✓ Final ausgefüllt und schreibgeschützt gespeichert';
    const date = program?.onboarding?.commitmentConfirmedAt ? new Date(program.onboarding.commitmentConfirmedAt).toLocaleString('de-DE') : 'gespeichertem Datum';
    $('#commitmentReadonlyCopy').textContent = `Bestätigt von ${details.name || program?.profile?.name || 'dir'} am ${date}${details.place ? ` in ${details.place}` : ''}. Deine Antworten und die digitale Klickbestätigung sind fest im Original-PDF hinterlegt.`;
  } else {
    onboardingFormsFinalizing.delete('start_commitment');
    const date = todayInBerlin();
    const draft = program?.onboarding?.formDrafts?.start_commitment || {};
    $('#commitmentName').value = draft.name || $('#onboardingName').value || program?.profile?.name || '';
    $('#commitmentStartDate').value = draft.startDate || program?.access?.programStartDate || date;
    $('#commitmentWhy').value = draft.why || '';
    $('#commitmentChange').value = draft.change || '';
    $('#commitmentCost').value = draft.costOfUnclarity || '';
    $('#commitmentPlace').value = draft.place || $('#onboardingCity').value || program?.profile?.city || '';
    $('#commitmentSignatureDate').value = draft.signatureDate || date;
    $('#commitmentAccepted').checked = draft.accepted === true;
    commitmentWizardStep = Math.min(4, Math.max(0, Number(draft.wizardStep) || 0));
    onboardingDraftStatus('start_commitment');
    renderCommitmentWizard();
    previewStatus.textContent = 'Schreibgeschützte Live-Vorschau wird vorbereitet …';
  }
  $('#commitmentDialog').showModal();
  if (!confirmed) updateCommitmentPdfPreview();
}

function closeCommitmentDialog(result = '') {
  const dialog = $('#commitmentDialog');
  if (!dialog) return;
  window.clearTimeout(commitmentPreviewTimer);
  commitmentPreviewController?.abort();
  commitmentPreviewController = null;
  if (dialog.open) dialog.close(result);
  dialog.removeAttribute('open');
}

function progressPercent() {
  if (!program) return 0;
  return Math.round(program.access.completedWeeks.length / 8 * 100);
}

function weekIsFinalized(week = currentWeek) {
  return (program?.access?.completedWeeks || []).map(Number).includes(Number(week));
}

function applyWeekReadOnlyState() {
  const finalized = weekIsFinalized();
  $('#activeWeek').classList.toggle('week-read-only', finalized);
  $('#uploadButton').hidden = finalized;
  const moreActions = $('#reopenCurrentWeek')?.closest('details');
  if (moreActions) moreActions.hidden = finalized;
  const composer = $('#claraJourneyForm');
  if (composer) composer.hidden = finalized;
  const saveState = $('#weekAutosaveState');
  if (saveState) saveState.hidden = finalized;
  const finalNote = $('#activeWeek .week-final-note');
  if (finalNote) finalNote.hidden = finalized;
  if (finalized) {
    $('#completeWeek').disabled = true;
    $('#completeWeek').textContent = 'Woche abgeschlossen ✓';
    $('#gateNote').textContent = 'Diese Woche ist abgeschlossen. Alle Schritte und gespeicherten Inhalte bleiben für dich anklickbar und schreibgeschützt.';
  }
}

function draftKeyFor(control) {
  const step = currentWeek === 1 ? program?.weekOne?.current_step : program?.weekState?.current_step;
  return `${step || 'general'}:${control.id || control.name || 'entry'}`;
}

function updateAutosaveState(label, state = '') {
  const target = $('#weekAutosaveState');
  if (!target) return;
  target.classList.remove('saving', 'saved', 'error');
  if (state) target.classList.add(state);
  target.querySelector('span').textContent = label;
}

function restoreWeekDraft() {
  if (weekIsFinalized()) return;
  const draft = { ...(local.drafts[currentWeek] || {}), ...(program?.weekDraft || {}) };
  local.drafts[currentWeek] = draft;
  $('#activeWeek').querySelectorAll('textarea, input[type="text"]').forEach((control) => {
    const saved = draft[draftKeyFor(control)];
    if (!control.value && typeof saved === 'string') control.value = saved;
  });
  saveLocal();
}

async function persistWeekDraft() {
  if (!program?.onboardingComplete || weekIsFinalized() || currentWeek !== activeProcessWeek(program.access)) return;
  const draft = local.drafts[currentWeek] || {};
  updateAutosaveState('Dein Arbeitsstand wird gespeichert …', 'saving');
  try {
    const result = await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_week_draft', week: currentWeek, draft }) });
    updateAutosaveState(`Arbeitsstand gespeichert · ${new Date(result.savedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, 'saved');
  } catch (error) {
    updateAutosaveState('Lokal gesichert – Server-Speicherung wird beim nächsten Eintrag erneut versucht.', 'error');
  }
}

async function clearDraftKeys(predicate) {
  clearTimeout(draftSaveTimer);
  local.drafts[currentWeek] ||= {};
  Object.keys(local.drafts[currentWeek]).filter(predicate).forEach((key) => { delete local.drafts[currentWeek][key]; });
  program.weekDraft = { ...(local.drafts[currentWeek] || {}) };
  saveLocal();
  if (!weekIsFinalized() && currentWeek === activeProcessWeek(program?.access)) {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_week_draft', week: currentWeek, draft: program.weekDraft }) });
  }
}

function queueDraftSave(control) {
  if (!control || weekIsFinalized()) return;
  local.drafts[currentWeek] ||= {};
  local.drafts[currentWeek][draftKeyFor(control)] = String(control.value || '').slice(0, 10000);
  program.weekDraft = { ...(local.drafts[currentWeek] || {}) };
  saveLocal();
  updateAutosaveState('Änderung erkannt …', 'saving');
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(persistWeekDraft, 700);
}

function queueDraftValue(key, value) {
  local.drafts[currentWeek] ||= {};
  local.drafts[currentWeek][key] = String(value);
  program.weekDraft = { ...(local.drafts[currentWeek] || {}) };
  saveLocal();
  updateAutosaveState('Änderung erkannt …', 'saving');
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(persistWeekDraft, 700);
}

function activeProcessWeek(access = program?.access) {
  const week = Number(access?.processWeek);
  if (Number.isInteger(week) && week >= 1 && week <= 8) return week;
  const completed = new Set((access?.completedWeeks || []).map(Number));
  return Array.from({ length: 8 }, (_, index) => index + 1).find((item) => !completed.has(item)) || 8;
}

function safeSelectedWeek(payload = program) {
  const canonicalWeek = activeProcessWeek(payload?.access);
  const selectedWeek = Number(payload?.selectedWeek);
  const selectedState = (payload?.access?.weekStates || []).find((state) => Number(state.week) === selectedWeek);
  return selectedState?.accessible ? selectedWeek : canonicalWeek;
}

function currentWeekStepProgress(week) {
  if (!program?.onboardingComplete) return { completed: 0, total: 0 };
  let statuses = [];
  if (Number(week) === 1 && program.weekOne) statuses = journeyStepStatuses(program.weekOne);
  else if (Number(program.selectedWeek) === Number(week) && program.weekState) statuses = guidedStepStatuses(program.weekState);
  return { completed: statuses.filter((item) => item.status === 'completed').length, total: statuses.length };
}

function renderProgressCelebration() {
  if (!program?.access) return null;
  const week = activeProcessWeek(program.access);
  const summary = (program.programWeeks || []).find((item) => Number(item.week) === week);
  const steps = currentWeekStepProgress(week);
  const celebration = buildProgressCelebration({
    activeWeek: week,
    completedWeeks: program.access.completedWeeks,
    clarityHistory: program.clarityHistory,
    completedSteps: steps.completed,
    totalSteps: steps.total,
    currentWeekTitle: summary?.title || `Woche ${week}`,
    onboardingComplete: program.onboardingComplete,
  });
  $('#celebrationWeekBadge').textContent = celebration.isComplete ? 'Programm abgeschlossen' : `Woche ${celebration.week} von 8`;
  $('#progressCelebrationTitle').textContent = celebration.title;
  $('#progressCelebrationPraise').textContent = celebration.praise;
  $('#celebrationPercent').textContent = `${celebration.percent} %`;
  $('#celebrationProgress').style.setProperty('--celebration-progress', `${celebration.percent}%`);
  $('#celebrationCompletedWeeks').textContent = celebration.completedWeeks;
  $('#celebrationClarity').textContent = `${celebration.currentScore ?? '—'} / 10`;
  $('#celebrationWeekSteps').textContent = celebration.totalSteps ? `${celebration.completedSteps} / ${celebration.totalSteps}` : '—';
  $('#celebrationClaraTitle').textContent = celebration.claraTitle;
  $('#celebrationClaraCopy').textContent = celebration.claraCopy;
  $('#celebrationContinue').textContent = celebration.ctaLabel;
  $('#celebrationContinue').dataset.week = String(celebration.week);
  $('#openProgressCelebration').setAttribute('aria-label', `${celebration.percent} Prozent abgeschlossen. Fortschritt ansehen.`);
  return celebration;
}

function openProgressCelebration() {
  const celebration = renderProgressCelebration();
  if (!celebration) return;
  const dialog = $('#progressCelebrationDialog');
  dialog.classList.remove('is-celebrating');
  dialog.showModal();
  requestAnimationFrame(() => dialog.classList.add('is-celebrating'));
}

async function loadProgram(week = null) {
  clearClaraStepTransition();
  const suffix = week ? `?week=${week}` : '';
  program = await request(`/api/participant-program${suffix}`);
  if (!customerWorkspace) {
    try { customerWorkspace = await request('/api/customer-records?action=overview'); }
    catch { customerWorkspace = null; }
  }
  const initialView = !initialViewResolved ? 'today' : null;
  currentWeek = safeSelectedWeek(program);
  currentContent = program.week;
  if (program.onboardingComplete && currentWeek >= 1) {
    try {
      const claraData = await request(`/api/participant-program?feature=clara-message&week=${currentWeek}`);
      journeyMessages = claraData.messages || [];
      claraCurrentPrompt = claraData.currentPrompt || '';
    } catch { journeyMessages = []; claraCurrentPrompt = ''; }
  }
  if (initialView) {
    initialViewResolved = true;
    showView(initialView);
    return;
  }
  render();
}

function renderClaraJourney() {
  const journey = $('#claraJourney');
  if (!journey) return;
  const clarityCheckinPending = currentWeek >= 2 && needsGuidedClarityCheckin(program?.weekState);
  const guidedStep = currentWeek >= 2 ? currentGuidedStep(program?.weekState) : null;
  const usesStructuredPanel = ['upload', 'scale', 'external', 'priority_selection'].includes(guidedStep?.kind);
  const weekOneUsesStructuredInput = currentWeek === 1 && program?.weekOne?.current_step !== 'THREE_WISHES_COLLECTION';
  const showOnlyCurrentPrompt = clarityCheckinPending || usesStructuredPanel || weekOneUsesStructuredInput;
  journey.classList.toggle('hidden', !program?.onboardingComplete);
  const initialPrompt = clarityCheckinPending
    ? '<article class="clara-message assistant"><span>Clara</span><p>Bevor wir inhaltlich weitergehen: <strong>Wie klar ist dir heute, was dein Ding ist?</strong><br><br>Halte kurz fest, ob sich seit der letzten Woche etwas verändert hat.</p></article>'
    : program?.weekOne?.current_step === 'THREE_WISHES_COLLECTION'
    ? `<article class="clara-message assistant"><span>Clara</span><p>${escapeHtml(claraCurrentPrompt || 'Stell dir vor, du hättest drei Wünsche frei – ganz unabhängig davon, ob sie gerade realistisch sind. Welche drei Dinge würdest du dir für dein Leben gerade am meisten wünschen?')}</p></article>`
    : guidedStep
      ? `<article class="clara-message assistant"><span>Clara</span><p>${escapeHtml(claraCurrentPrompt || guidedStep.question)}</p></article>`
      : `<article class="clara-message assistant"><span>Clara</span><p>${$('#questionHelp')?.innerHTML || `<strong>${escapeHtml($('#questionText')?.textContent || 'Lass uns gemeinsam den nächsten Schritt anschauen.')}</strong>`}</p></article>`;
  const historyHtml = journeyMessages.map((message) => `<article class="clara-message ${message.role}"><span>${message.role === 'assistant' ? 'Clara' : 'Du'}</span><p>${escapeHtml(message.content).replace(/\n/g, '<br>')}</p>${renderClaraResultCard(message.uiAction)}</article>`).join('');
  const messageHtml = claraEntranceLoading
    ? ''
    : journeyMessages.length && !showOnlyCurrentPrompt
      ? historyHtml
      : initialPrompt;
  const typingMarkup = journeyLoading || claraEntranceLoading
    ? '<article class="clara-message assistant loading" role="status" aria-label="Clara schreibt"><span>Clara</span><p><i></i><i></i><i></i><em>Clara schreibt …</em></p></article>'
    : '';
  $('#journeyMessages').innerHTML = `${messageHtml}${typingMarkup}`;
  journey.closest('.clara-card')?.classList.toggle('chat-mode', !journey.classList.contains('hidden'));
  const list = $('#journeyMessages');
  list.scrollTop = list.scrollHeight;
  const readOnly = weekIsFinalized();
  $('#claraJourneyForm').hidden = Boolean(readOnly || clarityCheckinPending || usesStructuredPanel || weekOneUsesStructuredInput);
  const stepControl = $('#claraStepControl');
  const nextButton = $('#claraNextStep');
  const stepReady = Boolean(claraStepTransition?.ready && claraStepTransition?.nextPrompt && !readOnly);
  stepControl.hidden = Boolean(readOnly || clarityCheckinPending || usesStructuredPanel || weekOneUsesStructuredInput);
  stepControl.classList.toggle('is-ready', stepReady);
  nextButton.disabled = !stepReady || journeyLoading || claraEntranceLoading;
  $('#claraJourneyInput').disabled = stepReady || journeyLoading || claraEntranceLoading;
  $('#sendJourneyMessage').disabled = stepReady || journeyLoading || claraEntranceLoading;
  $('#claraStepStatus').textContent = stepReady
    ? 'Alle Punkte sind erfasst. Clara hat keine offene Rückfrage mehr.'
    : journeyLoading || claraEntranceLoading
      ? 'Clara prüft deine Antwort anhand der aktuellen Abschlusskriterien …'
      : '„Nächster Schritt“ wird freigeschaltet, sobald alle offenen Fragen geklärt sind.';
  list.querySelectorAll('button').forEach((button) => { button.disabled = Boolean(readOnly); });
  list.querySelectorAll('[data-clara-confirm]').forEach((button) => button.addEventListener('click', () => confirmClaraResult(button.dataset.claraConfirm, button)));
  list.querySelectorAll('[data-clara-revise]').forEach((button) => button.addEventListener('click', () => {
    $('#claraJourneyInput').value = button.dataset.claraRevise;
    $('#claraJourneyInput').focus();
  }));
  syncClaraTypingState();
}

function clearClaraStepTransition() {
  if (claraStepTransitionTimer) clearTimeout(claraStepTransitionTimer);
  claraStepTransitionTimer = null;
  claraStepTransition = null;
}

function queueClaraStepTransition(transition) {
  clearClaraStepTransition();
  if (!transition?.ready || !transition?.nextPrompt) return;
  claraStepTransition = { ...transition };
  claraCurrentPrompt = transition.nextPrompt;
  renderClaraJourney();
  claraStepTransitionTimer = setTimeout(() => revealNextClaraStep(), 1600);
}

async function revealNextClaraStep() {
  if (!claraStepTransition?.ready || !claraStepTransition.nextPrompt || journeyLoading) return;
  const activeTransition = claraStepTransition;
  if (claraStepTransitionTimer) clearTimeout(claraStepTransitionTimer);
  claraStepTransitionTimer = null;
  const prompt = claraStepTransition.nextPrompt;
  claraStepTransition.ready = false;
  journeyLoading = true;
  const typingStartedAt = nowMs();
  renderClaraJourney();
  await waitForClaraTyping(typingStartedAt);
  if (claraStepTransition !== activeTransition) { journeyLoading = false; renderClaraJourney(); return; }
  if (!journeyMessages.some((message) => message.syntheticStep === claraStepTransition?.toStep)) {
    journeyMessages.push({ role: 'assistant', content: prompt, created_at: new Date().toISOString(), syntheticStep: claraStepTransition?.toStep || null });
  }
  journeyLoading = false;
  claraStepTransition = null;
  renderClaraJourney();
  $('#claraJourneyInput')?.focus();
}

function renderClaraResultCard(uiAction) {
  const confirmation = uiAction?.confirmation;
  if (uiAction?.type !== 'show_confirmation' || !confirmation?.wishes?.length) return '';
  const wishes = confirmation.wishes.map((wish, index) => `<li><b>${index + 1}</b><span>${escapeHtml(wish)}</span></li>`).join('');
  const token = escapeHtml(confirmation.token);
  return `<section class="clara-result-card"><strong>${escapeHtml(confirmation.title)}</strong><ol>${wishes}</ol><div><button class="primary" type="button" data-clara-confirm="${token}">Passt so</button><button class="secondary" type="button" data-clara-revise="Bitte lass uns die Zusammenfassung noch einmal gemeinsam überarbeiten.">Mit Clara überarbeiten</button><button class="secondary" type="button" data-clara-revise="Ich möchte meine ursprüngliche Formulierung behalten.">Meine Formulierung behalten</button></div></section>`;
}

async function confirmClaraResult(confirmationToken, button) {
  if (!confirmationToken || button.disabled || journeyLoading) return;
  button.closest('.clara-result-card').querySelectorAll('button').forEach((control) => { control.disabled = true; });
  journeyLoading = true;
  const typingStartedAt = nowMs();
  $('#sendJourneyMessage').disabled = true;
  renderClaraJourney();
  try {
    const result = await request('/api/participant-program?feature=clara-message', { method: 'POST', body: JSON.stringify({ week: 1, action: 'confirm_result', confirmationToken, clientMessageId: crypto.randomUUID() }) });
    await waitForClaraTyping(typingStartedAt);
    journeyMessages.push({ role: 'participant', content: 'Passt so', created_at: new Date().toISOString() }, result.message);
    program.weekOne = result.weekOne;
    program.weekOneGate = result.gate;
    currentContent.tasks = result.steps;
    journeyLoading = false;
    $('#sendJourneyMessage').disabled = false;
    render();
    queueClaraStepTransition(result.transition);
    toast('✓ Deine drei Wünsche wurden bestätigt.');
  } catch (error) {
    journeyLoading = false;
    $('#sendJourneyMessage').disabled = false;
    renderClaraJourney();
    toast(error.message);
  }
}

function weekNeedsClarityCheckin(week = currentWeek) {
  const normalizedWeek = Number(week);
  if (normalizedWeek === 1) return !program?.weekOne?.clarity_baseline?.completed;
  if (normalizedWeek >= 2 && normalizedWeek <= 8) return needsGuidedClarityCheckin(program?.weekState);
  return false;
}

function clarityScoreBeforeWeek(week) {
  return (program?.clarityHistory || [])
    .filter((item) => Number(item.week) < Number(week) && Number.isInteger(Number(item.score)) && Number(item.score) >= 1 && Number(item.score) <= 10)
    .map((item) => Number(item.score))
    .at(-1) ?? null;
}

function openClarityCheckin(week) {
  pendingClarityWeek = Number(week);
  selectedClarityScore = null;
  const previousScore = clarityScoreBeforeWeek(week);
  $('#clarityCheckinWeek').textContent = `Woche ${week} von 8`;
  $('#clarityCheckinTitle').textContent = Number(week) === 1 ? 'Deine Ausgangsbasis.' : 'Wo stehst du heute?';
  $('#clarityPreviousScore').classList.toggle('is-empty', previousScore === null);
  $('#clarityPreviousScore').innerHTML = previousScore === null
    ? '<small>Heute entsteht deine Ausgangsbasis</small><strong>—</strong><span>noch kein Vorwert</span>'
    : `<small>Dein Wert aus Woche ${Number(week) - 1}</small><strong>${previousScore}</strong><span>von 10</span>`;
  $('#claritySelectedScore').textContent = '—';
  $('#saveClarityCheckin').disabled = true;
  $('#saveClarityCheckin').textContent = 'Klarheitsscore speichern & Woche starten →';
  $$('#clarityCheckinScale [data-clarity-dialog-score]').forEach((button) => {
    button.classList.remove('selected');
    button.setAttribute('aria-pressed', 'false');
  });
  document.body.classList.add('clarity-checkin-open');
  $('#clarityCheckinDialog').showModal();
}

async function revealOpenedWeekWithClara() {
  beginClaraTurn();
  await waitForClaraTyping();
  finishClaraTurn();
}

function openClarityImprovement({ week, previousScore, score }) {
  $('#clarityImprovementWeek').textContent = `Woche ${week} · +${score - previousScore} ${score - previousScore === 1 ? 'Punkt' : 'Punkte'}`;
  $('#clarityImprovementScore').textContent = String(score);
  $('#clarityImprovementText').textContent = `Glückwunsch! Du hast deinen Klarheitsscore erfolgreich von ${previousScore} auf ${score} erhöht. Deine Entwicklung ist jetzt auch im Klarheitsdiagramm sichtbar.`;
  $('#continueAfterClarityImprovement').dataset.week = String(week);
  $('#clarityImprovementDialog').showModal();
}

async function saveWeeklyClarityCheckin() {
  const week = Number(pendingClarityWeek);
  const score = Number(selectedClarityScore);
  if (!Number.isInteger(week) || week < 1 || week > 8 || !Number.isInteger(score) || score < 1 || score > 10) return;
  const button = $('#saveClarityCheckin');
  const previousScore = clarityScoreBeforeWeek(week);
  button.disabled = true;
  button.textContent = 'Wird sicher gespeichert …';
  try {
    const stepAction = week === 1
      ? { type: 'save_clarity', score, reason: '' }
      : { type: 'save_clarity_checkin', stepId: 'weekly_clarity', score, changed: previousScore !== null && score !== previousScore, note: '' };
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: week === 1 ? 'week_1_update' : 'guided_week_update', week, stepAction }) });
    await loadProgram(week);
    $('#clarityCheckinDialog').close();
    document.body.classList.remove('clarity-checkin-open');
    pendingClarityWeek = null;
    if (previousScore !== null && score > previousScore) {
      todayMode = 'dashboard';
      showView('today');
      openClarityImprovement({ week, previousScore, score });
    } else {
      await revealOpenedWeekWithClara();
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Klarheitsscore speichern & Woche starten →';
    toast(error.message);
  }
}

async function openWeek(week) {
  try {
    claraEntranceLoading = false;
    todayMode = 'week';
    await loadProgram(week);
    showView('today');
    if (weekNeedsClarityCheckin(currentWeek)) {
      openClarityCheckin(currentWeek);
      return;
    }
    await revealOpenedWeekWithClara();
  } catch (error) {
    finishClaraTurn();
    toast(error.status === 403 ? 'Diese Woche ist noch gesperrt.' : error.message);
  }
}

function formatProgramDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Noch nicht festgelegt';
  return new Date(`${value}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function openWeekPreview(week) {
  const summary = (program?.programWeeks || []).find((item) => Number(item.week) === Number(week));
  const state = (program?.access?.weekStates || []).find((item) => Number(item.week) === Number(week));
  if (!summary || !state) return;
  const completed = Boolean(state.completed);
  const accessible = Boolean(state.accessible) && program.access.status !== 'paused';
  $('#weekPreviewEyebrow').textContent = `Woche ${week} · ${summary.mode}`;
  $('#weekPreviewTitle').textContent = summary.title;
  $('#weekPreviewDescription').textContent = summary.description || 'Diese Woche führt dich Schritt für Schritt durch den nächsten Teil deines Prozesses.';
  $('#weekPreviewTopics').innerHTML = (summary.topics || []).map((topic) => `<li><span>✓</span>${escapeHtml(topic)}</li>`).join('');
  $('#weekPreviewStatus').textContent = completed ? 'Woche abgeschlossen' : accessible ? 'Jetzt freigeschaltet' : program.access.status === 'paused' ? 'Programm pausiert' : 'Wird automatisch freigeschaltet';
  $('#weekPreviewDate').textContent = completed ? 'Du kannst deine Inhalte weiterhin ansehen.' : accessible ? `Freigeschaltet seit ${formatProgramDate(state.unlocksAt)}` : `Verfügbar ab ${formatProgramDate(state.unlocksAt)}`;
  const openButton = $('#openPreviewWeek');
  openButton.dataset.previewWeek = String(week);
  openButton.disabled = !accessible;
  openButton.textContent = accessible ? 'Woche öffnen →' : `Freigabe am ${formatProgramDate(state.unlocksAt)}`;
  $('#weekPreviewDialog').showModal();
}

function ensureWeekDialogs() {
  if ($('#weekActionDialog')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="weekActionDialog" class="week-action-dialog" aria-labelledby="weekActionTitle">
      <div class="week-action-shell"><button type="button" class="dialog-close" data-week-dialog-close aria-label="Fenster schließen">×</button><span class="week-action-icon" id="weekActionIcon">!</span><p class="eyebrow" id="weekActionEyebrow">Woche finalisieren</p><h2 id="weekActionTitle"></h2><p id="weekActionCopy"></p><div class="week-action-warning" id="weekActionWarning"></div><div class="week-action-buttons"><button type="button" class="secondary" data-week-dialog-close>Abbrechen</button><button type="button" class="primary" id="confirmWeekAction"></button></div></div>
    </dialog>
    <dialog id="weekReflectionDialog" class="week-reflection-dialog" aria-labelledby="weekReflectionTitle">
      <div class="week-reflection-shell"><button type="button" class="dialog-close" data-reflection-close aria-label="Reflexion schließen">×</button><p class="eyebrow" id="weekReflectionEyebrow"></p><h2 id="weekReflectionTitle"></h2><p class="reflection-summary" id="weekReflectionSummary"></p><section><span>Was diese Woche sichtbar wurde</span><ul id="weekReflectionHighlights"></ul></section><div class="reflection-grid"><article><span>Deine Entwicklung</span><p id="weekReflectionDevelopment"></p></article><article><span>Dein nächster Impuls</span><p id="weekReflectionImpulse"></p></article></div><blockquote id="weekReflectionClosing"></blockquote><form id="weekReflectionQuestionForm" class="reflection-question-form"><input type="hidden" name="week" /><span>Deine Frage für das persönliche Q&amp;A mit Markus</span><p>Notiere, was du vertiefen, hinterfragen oder gemeinsam sortieren möchtest. Die Frage landet direkt in deiner Kundenakte.</p><textarea name="question" rows="3" minlength="5" maxlength="1200" required placeholder="Was möchtest du mit Markus besprechen?"></textarea><button class="primary" type="submit">Frage fürs Q&amp;A speichern →</button><small id="weekReflectionQuestionState"></small></form></div>
    </dialog>`);
  $$('[data-week-dialog-close]').forEach((button) => button.addEventListener('click', () => { if (!$('#confirmWeekAction').disabled) $('#weekActionDialog').close(); }));
  $$('[data-reflection-close]').forEach((button) => button.addEventListener('click', () => $('#weekReflectionDialog').close()));
  $('#weekActionDialog').addEventListener('click', (event) => { if (event.target === event.currentTarget && !$('#confirmWeekAction').disabled) event.currentTarget.close(); });
  $('#weekReflectionDialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $('#confirmWeekAction').addEventListener('click', executeWeekAction);
  $('#weekReflectionQuestionForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),state=$('#weekReflectionQuestionState');button.disabled=true;state.textContent='Frage wird sicher gespeichert …';try{await request('/api/participant-program',{method:'POST',body:JSON.stringify({action:'support_question',week:Number(form.elements.week.value),question:form.elements.question.value.trim()})});state.textContent='Gespeichert – Markus sieht die Frage jetzt in deiner Kundenakte.';form.elements.question.value='';}catch(error){state.textContent=error.message||'Die Frage konnte noch nicht gespeichert werden.';}finally{button.disabled=false;}});
}

function openWeekActionDialog(action) {
  if (!program?.onboardingComplete || !currentContent || weekIsFinalized()) return;
  ensureWeekDialogs();
  pendingWeekAction = action;
  const reset = action === 'reset';
  $('#weekActionIcon').textContent = reset ? '↺' : '✓';
  $('#weekActionEyebrow').textContent = reset ? `Woche ${currentWeek} zurücksetzen` : `Woche ${currentWeek} finalisieren`;
  $('#weekActionTitle').textContent = reset ? 'Möchtest du wirklich neu beginnen?' : 'Möchtest du diese Woche abschließend beenden?';
  $('#weekActionCopy').textContent = reset
    ? 'Dabei werden nur die Eingaben, Uploads und Clara-Nachrichten deiner aktuell laufenden Woche gelöscht.'
    : 'Dein aktueller Stand wird final gespeichert. Danach erstellt Clara aus deinen Antworten deine persönliche Wochenreflexion.';
  $('#weekActionWarning').innerHTML = reset
    ? '<strong>Wichtig:</strong> Bereits abgeschlossene Wochen bleiben vollständig erhalten. Dieser Vorgang kann für die laufende Woche nicht rückgängig gemacht werden.'
    : '<strong>Wichtig:</strong> Nach diesem Abschluss kannst du die Woche weiterhin ansehen, aber keine Inhalte mehr verändern.';
  const confirm = $('#confirmWeekAction');
  confirm.disabled = false;
  confirm.textContent = reset ? 'Ja, laufende Woche zurücksetzen' : 'Woche finalisieren & Reflexion erstellen';
  $('#weekActionDialog').showModal();
}

function openWeekReflection(week) {
  ensureWeekDialogs();
  const reflection = (program?.weekReflections || []).find((item) => Number(item.week) === Number(week));
  if (!reflection) return;
  $('#weekReflectionEyebrow').textContent = `Wochenreflexion · Woche ${week}`;
  $('#weekReflectionTitle').textContent = reflection.title || `Deine Reflexion zu Woche ${week}`;
  $('#weekReflectionSummary').textContent = reflection.summary || '';
  $('#weekReflectionHighlights').innerHTML = (reflection.highlights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  $('#weekReflectionDevelopment').textContent = reflection.development || '';
  $('#weekReflectionImpulse').textContent = reflection.nextImpulse || '';
  $('#weekReflectionClosing').textContent = reflection.closing || '';
  $('#weekReflectionQuestionForm').elements.week.value=String(week);
  $('#weekReflectionQuestionState').textContent='';
  $('#weekReflectionDialog').showModal();
}

async function executeWeekAction() {
  const action = pendingWeekAction;
  if (!action) return;
  const completedWeek = currentWeek;
  const button = $('#confirmWeekAction');
  button.disabled = true;
  button.textContent = action === 'reset' ? 'Woche wird zurückgesetzt …' : 'Clara erstellt deine Reflexion …';
  try {
    if (action === 'reset') {
      await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'reopen_week', week: completedWeek }) });
      delete local.answers[completedWeek];
      delete local.uploads[completedWeek];
      delete local.drafts[completedWeek];
      if (completedWeek === 1) { delete local.clarityStart; journeyMessages = []; }
      saveLocal();
      $('#weekActionDialog').close();
      await loadProgram(completedWeek);
      toast(`Woche ${completedWeek} wurde vollständig zurückgesetzt.`);
    } else {
      clearTimeout(draftSaveTimer);
      await persistWeekDraft();
      await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'complete_week', week: completedWeek }) });
      delete local.drafts[completedWeek];
      saveLocal();
      $('#weekActionDialog').close();
      todayMode = 'dashboard'; await loadProgram(); showView('today');
      toast(completedWeek === 8 ? 'Dein digitaler Prozess ist final abgeschlossen.' : `Woche ${completedWeek} ist final abgeschlossen.`);
      openWeekReflection(completedWeek);
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = action === 'reset' ? 'Ja, laufende Woche zurücksetzen' : 'Woche finalisieren & Reflexion erstellen';
    toast(error.message);
  }
}

function reviewParagraph(value, empty = 'Für diesen Schritt ist noch kein Inhalt gespeichert.') {
  const text = String(value || '').trim();
  return `<p>${text ? escapeHtml(text).replace(/\n/g, '<br>') : escapeHtml(empty)}</p>`;
}

function weekOneReviewDetails(stepId) {
  const state = program?.weekOne || {};
  const wishes = Array.isArray(state.wishes) ? state.wishes : [];
  const details = {
    wishes_collected: {
      question: 'Welche drei Dinge wünschst du dir für dein Leben aktuell am meisten?',
      content: wishes.some((wish) => wish.raw_wish)
        ? `<ol class="step-review-list">${wishes.map((wish) => `<li>${escapeHtml(wish.raw_wish || 'Noch nicht beantwortet')}</li>`).join('')}</ol>`
        : reviewParagraph(''),
    },
    wishes_deepened: {
      question: 'Was steckt für dich persönlich hinter deinen drei Wünschen?',
      content: wishes.some((wish) => wish.completed || wish.voluntary_details?.length)
        ? `<div class="step-review-stack">${wishes.map((wish, index) => `<article><small>Wunsch ${index + 1}</small><strong>${escapeHtml(wish.raw_wish || 'Noch nicht erfasst')}</strong>${reviewParagraph((wish.voluntary_details || []).join('\n\n') || wish.emotional_meaning, 'Noch nicht vertieft.')}</article>`).join('')}</div>`
        : reviewParagraph(''),
    },
    target: {
      question: 'Was soll sich nach den acht Wochen für dich konkret verändert haben?',
      content: `${reviewParagraph(state.fdd_target?.raw_answer)}${state.fdd_target?.clarification_raw ? `<div class="step-review-addition"><small>Deine Konkretisierung</small>${reviewParagraph(state.fdd_target.clarification_raw)}</div>` : ''}`,
    },
    clarity: {
      question: 'Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?',
      content: state.clarity_baseline?.score ? `<div class="step-review-score"><strong>${Number(state.clarity_baseline.score)}</strong><span>von 10</span></div>${reviewParagraph(state.clarity_baseline.reason_raw, 'Keine zusätzliche Begründung gespeichert.')}` : reviewParagraph(''),
    },
    career: {
      question: 'Welcher Lebenslauf und welche beruflichen Stationen wurden festgehalten?',
      content: state.career_history?.cv_uploaded
        ? `<div class="step-review-file"><span>▤</span><div><strong>${escapeHtml(state.career_history.cv_file_name || 'Lebenslauf')}</strong><small>Erfolgreich hochgeladen und bestätigt</small></div></div>${state.career_history.stations?.length ? `<ul class="step-review-list">${state.career_history.stations.map((station) => `<li>${escapeHtml([station.from && station.to ? `${station.from}–${station.to}` : station.from, station.role, station.company, station.description_raw].filter(Boolean).join(' · '))}</li>`).join('')}</ul>` : ''}`
        : reviewParagraph(''),
    },
    reflection: {
      question: 'Was nimmst du aus dieser Woche mit?',
      content: reviewParagraph(typeof state.week_summary === 'string' ? state.week_summary : '', state.career_history?.completed ? 'Deine Ist-Aufnahme ist vollständig abgeschlossen.' : 'Die Wochenreflexion ist noch nicht abgeschlossen.'),
    },
  };
  return details[stepId] || { question: 'Dein persönlicher Wochenschritt', content: reviewParagraph('') };
}

function guidedReviewDetails(stepId) {
  const state = program?.weekState || {};
  if (stepId === 'weekly_clarity') {
    const checkin = state.clarity_checkin || {};
    const changeLabel = checkin.changed === true ? 'Ja, ich nehme eine Veränderung wahr.' : checkin.changed === false ? 'Nein, noch keine spürbare Veränderung.' : 'Noch nicht beantwortet.';
    return {
      question: guidedClarityStep(state)?.question || 'Wie klar ist dir heute, was dein Ding ist?',
      content: checkin.completed
        ? `<div class="step-review-score"><strong>${Number(checkin.score)}</strong><span>von 10</span></div>${reviewParagraph(changeLabel)}${checkin.note ? `<div class="step-review-addition"><small>Deine Beobachtung</small>${reviewParagraph(checkin.note)}</div>` : ''}`
        : reviewParagraph(''),
    };
  }
  const step = guidedWeekDefinition(currentWeek)?.steps.find((item) => item.id === stepId);
  const answer = state.answers?.[stepId];
  const document = state.documents?.[stepId];
  const external = state.external_results?.[stepId];
  let content = reviewParagraph(answer?.raw_answer);
  if (step?.kind === 'priority_selection' && answer?.items?.length) content = `<ol class="step-review-priority">${answer.items.map((item, index) => `<li><b>${index + 1}</b><span>${escapeHtml(item)}</span></li>`).join('')}</ol>`;
  if (document) content = `<div class="step-review-file"><span>▤</span><div><strong>${escapeHtml(document.fileName || 'Hochgeladenes Dokument')}</strong><small>Sicher gespeichert</small></div></div>`;
  if (external) content = `<div class="step-review-file verified"><span>✓</span><div><strong>Technisches Ergebnis bestätigt</strong><small>${external.completedAt ? new Date(external.completedAt).toLocaleString('de-DE') : 'Serverseitig geprüft'}</small></div></div>`;
  return { question: step?.question || 'Dein persönlicher Wochenschritt', content };
}

function openStepReview(stepId) {
  const statuses = currentWeek === 1 ? journeyStepStatuses(program?.weekOne) : guidedStepStatuses(program?.weekState);
  const step = statuses.find((item) => item.id === stepId);
  if (!step) return;
  const details = currentWeek === 1 ? weekOneReviewDetails(stepId) : guidedReviewDetails(stepId);
  const completed = step.status === 'completed';
  $('#stepReviewEyebrow').textContent = `Woche ${currentWeek} · ${completed ? 'Abgeschlossen' : step.status === 'in_progress' ? 'Aktueller Schritt' : 'Geplant'}`;
  $('#stepReviewTitle').textContent = step.title;
  $('#stepReviewStatus').textContent = completed ? '✓ Abgeschlossen · nur ansehen' : step.status === 'in_progress' ? '● Aktuell in Bearbeitung' : '○ Noch nicht bearbeitet';
  $('#stepReviewStatus').className = `step-review-status ${step.status}`;
  $('#stepReviewQuestion').textContent = details.question;
  $('#stepReviewContent').innerHTML = details.content;
  $('#stepReviewLock').textContent = completed
    ? 'Dieser Schritt ist abgeschlossen. Du kannst alle Inhalte weiterhin ansehen, aber nicht mehr verändern.'
    : step.status === 'in_progress'
      ? 'Die Bearbeitung dieses Schritts erfolgt weiterhin im Dialog mit Clara. Diese Detailansicht verändert keine Inhalte.'
      : 'Dieser Schritt ist noch nicht an der Reihe. Du kannst bereits sehen, was dich erwartet.';
  $('#stepReviewDialog').showModal();
}

function stepTaskMarkup(step) {
  const statusSymbol = { open: '○', in_progress: '●', completed: '✓' };
  const action = step.status === 'completed' ? 'Ansehen →' : step.status === 'in_progress' ? 'Öffnen →' : 'Vorschau →';
  return `<button type="button" class="task week-one-task ${step.status}" data-step-review="${escapeHtml(step.id)}"><span class="step-state" aria-hidden="true">${statusSymbol[step.status]}</span><span><b>${escapeHtml(step.title)}</b>${step.status === 'in_progress' ? '<small>Gerade dabei</small>' : ''}</span><i>${action}</i></button>`;
}

function wireStepReviewButtons() {
  $$('#taskList [data-step-review]').forEach((button) => button.addEventListener('click', () => openStepReview(button.dataset.stepReview)));
}

function currentClarityMeasurement() {
  return (program?.clarityHistory || []).filter((item) => Number.isInteger(Number(item.score)) && Number(item.score) >= 1 && Number(item.score) <= 10).at(-1) || null;
}

function renderDashboardClarityChart() {
  const target = $('#dashboardClarityChart');
  if (!target) return;
  const history = program?.clarityHistory || [];
  const measurements = history.filter((item) => Number.isInteger(Number(item.score)) && Number(item.score) >= 1 && Number(item.score) <= 10);
  const latest = measurements.at(-1) || null;
  const first = measurements[0] || null;
  const delta = latest && first ? Number(latest.score) - Number(first.score) : null;
  const nextMeasurement = history.find((item) => !Number.isInteger(Number(item.score)) || Number(item.score) < 1 || Number(item.score) > 10);
  $('#dashboardClarityValue').textContent = latest?.score || '—';
  $('#dashboardClarityDelta').textContent = delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`;
  $('#dashboardClarityDelta').className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  $('#dashboardClarityCount').textContent = `${measurements.length} / 8`;
  $('#dashboardClarityNext').textContent = nextMeasurement ? `Woche ${nextMeasurement.week}` : 'Vollständig';
  target.setAttribute('aria-label', measurements.length ? `Klarheitsverlauf: ${measurements.map((item) => `Woche ${item.week}: ${item.score} von 10`).join(', ')}` : 'Noch keine Klarheitswerte vorhanden');

  const left = 66;
  const right = 842;
  const top = 24;
  const bottom = 236;
  const x = (week) => left + ((Number(week) - 1) / 7) * (right - left);
  const y = (score) => bottom - ((Number(score) - 1) / 9) * (bottom - top);
  const pointPairs = measurements.map((item) => [x(item.week), y(item.score)]);
  const points = pointPairs.map(([pointX, pointY]) => `${pointX},${pointY}`).join(' ');
  const linePath = pointPairs.map(([pointX, pointY], index) => `${index ? 'L' : 'M'} ${pointX} ${pointY}`).join(' ');
  const areaPath = pointPairs.length > 1 ? `${linePath} L ${pointPairs.at(-1)[0]} ${bottom} L ${pointPairs[0][0]} ${bottom} Z` : '';
  const scoreColor = (score) => Number(score) >= 7 ? '#c89a2e' : Number(score) >= 4 ? '#e98943' : '#d26758';
  const horizontalGrid = [1, 4, 7, 10].map((score) => `<g><line class="clarity-grid-line" x1="${left}" y1="${y(score)}" x2="${right}" y2="${y(score)}"></line><text x="42" y="${y(score) + 4}">${score}</text></g>`).join('');
  const verticalGrid = Array.from({ length: 8 }, (_, index) => `<line class="clarity-week-line" x1="${x(index + 1)}" y1="${top}" x2="${x(index + 1)}" y2="${bottom}"></line>`).join('');
  const weekLabels = Array.from({ length: 8 }, (_, index) => `<text class="week-label" x="${x(index + 1)}" y="274">W${index + 1}</text>`).join('');
  const markerLines = measurements.map((item) => `<line class="clarity-marker-line" x1="${x(item.week)}" y1="${y(item.score) + 13}" x2="${x(item.week)}" y2="${bottom}"></line>`).join('');
  const dots = measurements.map((item, index) => `<g class="clarity-point ${index === measurements.length - 1 ? 'is-latest' : ''}" style="--point-index:${index}"><circle class="clarity-point-pulse" cx="${x(item.week)}" cy="${y(item.score)}" r="18" stroke="${scoreColor(item.score)}"></circle><circle class="clarity-point-core" cx="${x(item.week)}" cy="${y(item.score)}" r="8" fill="${scoreColor(item.score)}"></circle><text x="${x(item.week)}" y="${y(item.score) - 20}">${item.score}</text></g>`).join('');
  target.innerHTML = `<svg viewBox="0 0 880 292" aria-hidden="true" focusable="false"><defs><linearGradient id="clarityLineGradient" x1="0" x2="1"><stop offset="0" stop-color="#ff765e"></stop><stop offset=".48" stop-color="#ffad54"></stop><stop offset="1" stop-color="#f2cf6b"></stop></linearGradient><linearGradient id="clarityAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb45e" stop-opacity=".32"></stop><stop offset="1" stop-color="#ff765e" stop-opacity="0"></stop></linearGradient><linearGradient id="clarityTargetGradient" x1="0" x2="1"><stop offset="0" stop-color="#a87818" stop-opacity=".13"></stop><stop offset=".55" stop-color="#f2c85b" stop-opacity=".26"></stop><stop offset="1" stop-color="#ffe6a0" stop-opacity=".16"></stop></linearGradient><filter id="clarityGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs><rect class="clarity-chart-surface" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"></rect><rect class="clarity-low-band" x="${left}" y="${y(4)}" width="${right - left}" height="${bottom - y(4)}"></rect><rect class="clarity-growth-band" x="${left}" y="${y(7)}" width="${right - left}" height="${y(4) - y(7)}"></rect><rect class="clarity-target-band" x="${left}" y="${top}" width="${right - left}" height="${y(7) - top}"></rect>${verticalGrid}${horizontalGrid}${markerLines}${areaPath ? `<path class="clarity-progress-area" d="${areaPath}"></path>` : ''}${points ? `<path class="clarity-progress-line clarity-progress-glow" d="${linePath}"></path><path class="clarity-progress-line" d="${linePath}"></path>` : ''}${dots}${weekLabels}<g class="target-chip"><rect x="${right - 170}" y="${top + 10}" width="158" height="28" rx="14"></rect><text class="target-label" x="${right - 91}" y="${top + 28}">ZIELBEREICH 7–10</text></g></svg>${measurements.length ? '' : '<p>Noch kein Klarheitswert gespeichert. Deine erste Messung entsteht in Woche 1.</p>'}`;
}

function renderProgramDashboard() {
  if (!program?.access) return;
  const summaries = new Map((program.programWeeks || []).map((week) => [Number(week.week), week]));
  const states = program.access.weekStates || [];
  const activeWeek = activeProcessWeek(program.access);
  const activeSummary = summaries.get(activeWeek) || summaries.get(1);
  const activeState = states.find((state) => Number(state.week) === activeWeek);
  const activeAccessible = Boolean(activeState?.accessible) && program.access.status !== 'paused';
  const nextState = states.find((state) => !state.accessible && state.unlocksAt);
  const completed = program.access.completedWeeks.length;
  $('#dashboardProgressTitle').textContent = completed === 8 ? 'Alle 8 Wochen abgeschlossen' : activeAccessible ? `Woche ${activeWeek} von 8` : `Woche ${activeWeek} öffnet als Nächstes`;
  $('#dashboardProgressCopy').textContent = `${completed} von 8 Wochen abgeschlossen · Projektstart ${formatProgramDate(program.access.programStartDate)}.`;
  $('#dashboardStatusBadge').textContent = program.access.status === 'paused' ? 'Programm pausiert' : completed === 8 ? 'Programm abgeschlossen' : program.access.fullProgramAccess ? 'Demo-Modus · alle Wochen offen' : activeAccessible ? 'Programm aktiv' : 'Nächste Woche noch gesperrt';
  $('#dashboardCurrentNumber').textContent = String(activeWeek).padStart(2, '0');
  $('#dashboardCurrentTitle').textContent = activeSummary?.title || 'Deine aktuelle Woche';
  $('#dashboardCurrentCopy').textContent = activeSummary ? activeAccessible ? program.access.fullProgramAccess ? `${activeSummary.mode} · Im Demo-Modus kannst du nach dem Abschluss direkt mit der nächsten Woche weitermachen.` : `${activeSummary.mode} · Diese Woche ist entsprechend deinem persönlichen Zeitplan freigeschaltet.` : `${activeSummary.mode} · Öffnet am ${formatProgramDate(activeState?.unlocksAt)}. Bis dahin bleibt der Bereich gesperrt.` : 'Dein nächster Bereich wird vorbereitet.';
  $('#dashboardStartDate').textContent = formatProgramDate(program.access.programStartDate);
  $('#dashboardEndDate').textContent = formatProgramDate(program.access.programEndDate);
  $('#dashboardNextDate').textContent = nextState ? `Woche ${nextState.week} · ${formatProgramDate(nextState.unlocksAt)}` : 'Alle Wochen freigeschaltet';
  const currentButton = $('#openCurrentWeek');
  currentButton.dataset.dashboardWeek = String(activeWeek);
  currentButton.disabled = !activeAccessible;
  $('#dashboardWeekGrid').innerHTML = states.map((state) => {
    const summary = summaries.get(Number(state.week));
    const isCurrent = Number(state.week) === Number(activeWeek);
    const className = state.completed ? 'completed' : isCurrent && state.accessible ? 'current' : state.accessible ? 'available' : 'locked';
    const status = state.completed ? 'Abgeschlossen' : isCurrent && state.accessible ? 'Aktuell' : state.accessible ? 'Verfügbar' : `Ab ${formatProgramDate(state.unlocksAt)}`;
    const icon = state.completed ? '✓' : isCurrent && state.accessible ? '●' : state.accessible ? '→' : '○';
    return `<button type="button" class="dashboard-week-tile ${className}" data-preview-week="${state.week}"><span>${icon}</span><small>Woche ${state.week}</small><b>${escapeHtml(summary?.title || `Woche ${state.week}`)}</b><i>${escapeHtml(status)}</i></button>`;
  }).join('');
  $$('#dashboardWeekGrid [data-preview-week]').forEach((button) => button.addEventListener('click', () => openWeekPreview(Number(button.dataset.previewWeek))));
  renderDashboardClarityChart();
}

function renderPausedState() {
  let banner = $('#programPaused');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'programPaused';
    banner.className = 'program-paused hidden';
    banner.innerHTML = '<strong>Dein Programm ist aktuell pausiert.</strong><span>Bitte wende dich an Markus. Deine bisherigen Inhalte bleiben erhalten.</span>';
    document.querySelector('main').prepend(banner);
  }
  banner.classList.toggle('hidden', program?.access.status !== 'paused');
}

function renderLockedViewNotice() {
  const activeView = $$('aside nav button.active')[0]?.dataset.view || 'today';
  const shouldShow = !program?.onboardingComplete && lockedNonOnboardingViews.includes(activeView);
  const scope = $('.screen.active');
  if (!scope) return;

  let notice = scope.querySelector('.view-lock-notice');
  if (!notice && shouldShow) {
    notice = document.createElement('div');
    notice.className = 'view-lock-notice';
    notice.innerHTML = '<strong>Starte bitte zuerst dein Onboarding</strong><span>Dein Weg, deine Erkenntnisse und Dokumente sind bereits sichtbar. Bearbeiten kannst du sie, sobald du dein Onboarding begonnen hast.</span>';
    scope.insertBefore(notice, scope.firstChild);
  }

  if (notice) {
    notice.classList.toggle('hidden', !shouldShow);
  }
}

async function updateWeekOne(stepAction) {
  const draftPrefix = `${program?.weekOne?.current_step || 'general'}:`;
  const flow = $('#weekOneFlow');
  const errorBox = $('#weekOneError');
  if (errorBox) errorBox.textContent = '';
  if (flow) {
    flow.classList.add('is-saving');
    flow.querySelectorAll('button, input, textarea').forEach((control) => { control.disabled = true; });
  }
  beginClaraTurn();
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'week_1_update', stepAction }) });
    await clearDraftKeys((key) => key.startsWith(draftPrefix)).catch(() => {});
    await loadProgram(1);
    await waitForClaraTyping();
    finishClaraTurn();
    $('#weekOneFlow')?.classList.remove('is-saving');
    const nextControl = $('#weekOneFlow textarea:not([disabled]), #weekOneFlow input:not([disabled]), #weekOneFlow button:not([disabled])');
    nextControl?.focus({ preventScroll: true });
    $('#questionText')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('✓ Deine Antwort wurde gespeichert.');
  } catch (error) {
    finishClaraTurn();
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message);
    if (flow) {
      flow.classList.remove('is-saving');
      flow.querySelectorAll('button, input, textarea').forEach((control) => { control.disabled = false; });
    }
  }
}

function weekOneTextarea(id, placeholder = 'Schreib, was dir spontan in den Kopf kommt …') {
  return `<textarea id="${id}" placeholder="${placeholder}"></textarea>`;
}

function startThreeWishesSpeech(button) {
  const Recognition = resolveSpeechRecognition(window);
  if (!Recognition) { toast('Spracheingabe wird von diesem Browser nicht unterstützt.'); return; }
  const recognition = new Recognition();
  recognition.lang = 'de-DE';
  recognition.interimResults = false;
  button.disabled = true;
  button.textContent = '● Ich höre zu …';
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map((result) => result[0]?.transcript || '').join(' ').trim();
    const match = transcript.match(/wunsch\s*(?:1|eins)\s*[:.,-]?\s*(.*?)\s+wunsch\s*(?:2|zwei)\s*[:.,-]?\s*(.*?)\s+wunsch\s*(?:3|drei)\s*[:.,-]?\s*(.*)$/i);
    if (match) [1, 2, 3].forEach((number) => { $(`#wish${number}`).value = match[number].trim(); });
    else $('#weekOneError').textContent = 'Ich habe daraus noch nicht sicher drei einzelne Wünsche erkannt. Nenne mir bitte Wunsch 1, Wunsch 2 und Wunsch 3 getrennt.';
  };
  recognition.onerror = () => { $('#weekOneError').textContent = 'Die Spracheingabe konnte nicht verarbeitet werden. Bitte versuche es erneut oder tippe deine Wünsche ein.'; };
  recognition.onend = () => { button.disabled = false; button.textContent = '⌁ Spracheingabe'; };
  recognition.start();
}

function renderWeekOne() {
  const state = program.weekOne;
  if (!state) return;
  $('#activeWeek').classList.remove('motivator-priority-step');
  $('#guidedWeekFlow')?.remove();
  const firstName = (program.profile?.name || '').trim().split(/\s+/)[0];
  const prompt = weekOnePrompt(state, firstName);
  $('#activeWeek').classList.toggle('entry-step', prompt.type === 'entry');
  $('#activeWeek').dataset.journeyStep = prompt.type;
  let flow = $('#weekOneFlow');
  if (!flow) {
    flow = document.createElement('div');
    flow.id = 'weekOneFlow';
    $('#answerForm').before(flow);
  }
  flow.classList.remove('is-saving');
  $('#answerForm').classList.add('hidden');
  $('#savedAnswer').classList.add('hidden');
  $('#questionLabel').textContent = prompt.type === 'entry' ? 'Willkommen in Woche 1' : '';
  $('#questionText').textContent = prompt.title;
  const questionParts = [prompt.transition || '', prompt.quote ? `„${prompt.quote}“` : '', prompt.question || '', prompt.help || ''].filter(Boolean);
  $('#questionHelp').innerHTML = prompt.type === 'wishes'
    ? ''
    : questionParts.map((part, index) => index === 0 ? `<strong>${escapeHtml(part)}</strong>` : escapeHtml(part)).join('<br><br>');

  if (prompt.type === 'entry') {
    flow.innerHTML = '<button class="primary" data-week-one-action="begin">Mit Woche 1 beginnen →</button><p id="weekOneError" class="week-one-error"></p>';
  } else if (prompt.type === 'wishes') {
    flow.innerHTML = '<p id="weekOneError" class="week-one-error"></p>';
  } else if (prompt.type === 'wish_followup') {
    flow.innerHTML = `${weekOneTextarea('weekOneAnswer')}<div class="week-one-actions"><button type="button" class="voice" data-target="weekOneAnswer">⌁ Spracheingabe</button><button class="primary" data-week-one-action="wish-followup">Weiter →</button></div><p id="weekOneError" class="week-one-error"></p>`;
  } else if (prompt.type === 'target' || prompt.type === 'target_clarify') {
    flow.innerHTML = `${weekOneTextarea('weekOneAnswer')}<div class="week-one-actions"><button type="button" class="voice" data-target="weekOneAnswer">⌁ Spracheingabe</button><button class="primary" data-week-one-action="${prompt.type === 'target' ? 'target' : 'target-clarify'}">Weiter →</button></div><p id="weekOneError" class="week-one-error"></p>`;
  } else if (prompt.type === 'clarity') {
    if (state.clarity_baseline.completed) {
      flow.innerHTML = `<div class="clarity-saved"><strong>${state.clarity_baseline.score} von 10 – gespeichert.</strong><p>Wenn du möchtest: Warum hast du gerade diese Zahl gewählt?</p></div>${weekOneTextarea('clarityReason', 'Optional: Deine Begründung')}<button class="primary" data-week-one-action="clarity-continue">Weiter →</button><p id="weekOneError" class="week-one-error"></p>`;
    } else {
      flow.innerHTML = `<div class="clarity-scale" role="group" aria-label="Klarheitswert">${Array.from({ length: 10 }, (_, index) => `<button type="button" data-clarity-score="${index + 1}">${index + 1}</button>`).join('')}</div><p id="weekOneError" class="week-one-error"></p>`;
    }
  } else if (prompt.type === 'career_choice') {
    flow.innerHTML = '<div class="journey-upload"><div class="journey-upload-copy"><span>⇧</span><div><strong>Lebenslauf</strong><small>Lade deinen aktuellen Lebenslauf hoch.</small></div></div><label class="journey-upload-action" for="fileInput">↑ Datei auswählen</label><small class="journey-upload-meta">PDF, DOCX, JPG oder PNG · maximal 10 MB</small></div><p id="weekOneError" class="week-one-error"></p>';
  } else if (prompt.type === 'career_cv') {
    const uploadedAt = state.career_history.cv_uploaded_at || state.updated_at;
    const uploadedLabel = uploadedAt ? new Date(uploadedAt).toLocaleString('de-DE') : 'soeben';
    flow.innerHTML = `<div class="cv-required-card uploaded"><span class="cv-required-icon">✓</span><div><strong>${escapeHtml(state.career_history.cv_file_name || 'Lebenslauf')}</strong><small>Erfolgreich hochgeladen · ${escapeHtml(uploadedLabel)}</small></div><span class="cv-upload-badge">Hochgeladen</span></div><label class="journey-upload-action journey-upload-change" for="fileInput">Datei ändern</label><label class="career-confirm-check cv-upload-confirm"><input type="checkbox" id="cvUploadConfirmed"><span><strong>Ich bestätige, dass mein Lebenslauf vollständig hochgeladen wurde.</strong></span></label><p class="week-one-example">Erst nach dieser Bestätigung kannst du Woche 1 abschließen.</p><p id="weekOneError" class="week-one-error"></p>`;
  } else if (prompt.type === 'career_dialog') {
    flow.innerHTML = `${weekOneTextarea('careerAnswer', prompt.type === 'career_cv' ? 'Erkannte Stationen korrigieren oder fehlende Station ergänzen …' : 'Deine wichtigsten beruflichen Stationen …')}<label class="career-confirm-check"><input type="checkbox" id="careerConfirmed"><span>Die wesentlichen Stationen sind vollständig. Es fehlt keine wichtige berufliche Station.</span></label><div class="week-one-actions"><button type="button" class="voice" data-target="careerAnswer">⌁ Spracheingabe</button><button class="primary" data-week-one-action="career-save">Weiter →</button></div><p id="weekOneError" class="week-one-error"></p>`;
  } else if (prompt.type === 'career_confirm') {
    flow.innerHTML = '<div class="career-choice"><button class="primary" data-week-one-action="career-confirm">Ja, vollständig →</button><button class="secondary" data-week-one-action="career-add">Eine Station ergänzen</button></div><p id="weekOneError" class="week-one-error"></p>';
  } else if (prompt.type === 'review' && state.career_history.cv_uploaded) {
    const uploadedAt = state.career_history.cv_uploaded_at || state.updated_at;
    const uploadedLabel = uploadedAt ? new Date(uploadedAt).toLocaleString('de-DE') : 'soeben';
    flow.innerHTML = `<div class="week-one-review"><span>✓</span><p>Alle vier Schritte deiner Ist-Aufnahme sind abgeschlossen.</p></div><div class="cv-required-card uploaded"><span class="cv-required-icon">✓</span><div><strong>${escapeHtml(state.career_history.cv_file_name || 'Lebenslauf')}</strong><small>Erfolgreich hochgeladen · ${escapeHtml(uploadedLabel)}</small></div><span class="cv-upload-badge">Hochgeladen</span></div><label class="career-confirm-check cv-upload-confirm confirmed"><input type="checkbox" checked disabled><span><strong>Ich bestätige, dass mein Lebenslauf vollständig hochgeladen wurde.</strong></span></label><p id="weekOneError" class="week-one-error"></p>`;
  } else {
    flow.innerHTML = '<div class="week-one-review"><span>✓</span><p>Alle vier Schritte deiner Ist-Aufnahme sind abgeschlossen.</p></div><p id="weekOneError" class="week-one-error"></p>';
  }
  if ((prompt.type === 'career_dialog' || prompt.type === 'career_cv') && state.career_history.stations?.length) {
    $('#careerAnswer').value = state.career_history.stations.map((station) => [station.from && station.to ? `${station.from}–${station.to}` : station.from, station.role, station.company, station.description_raw].filter(Boolean).join(' · ')).join('\n');
  }

  flow.querySelector('[data-week-one-action="begin"]')?.addEventListener('click', () => updateWeekOne({ type: 'begin' }));
  flow.querySelector('#wishSpeech')?.addEventListener('click', (event) => startThreeWishesSpeech(event.currentTarget));
  flow.querySelector('[data-week-one-action="save-wishes"]')?.addEventListener('click', () => updateWeekOne({ type: 'save_wishes', wishes: [$('#wish1').value, $('#wish2').value, $('#wish3').value] }));
  flow.querySelector('[data-week-one-action="wish-followup"]')?.addEventListener('click', () => updateWeekOne({ type: 'save_wish_followup', wishIndex: prompt.wishIndex, answer: $('#weekOneAnswer').value }));
  flow.querySelector('[data-week-one-action="target"]')?.addEventListener('click', () => updateWeekOne({ type: 'save_target', answer: $('#weekOneAnswer').value }));
  flow.querySelector('[data-week-one-action="target-clarify"]')?.addEventListener('click', () => updateWeekOne({ type: 'clarify_target', answer: $('#weekOneAnswer').value }));
  flow.querySelectorAll('[data-clarity-score]').forEach((button) => button.addEventListener('click', () => updateWeekOne({ type: 'save_clarity', score: Number(button.dataset.clarityScore) })));
  flow.querySelector('[data-week-one-action="clarity-continue"]')?.addEventListener('click', () => updateWeekOne({ type: 'continue_clarity', reason: $('#clarityReason').value }));
  flow.querySelector('#cvUploadConfirmed')?.addEventListener('change', (event) => {
    if (event.currentTarget.checked) updateWeekOne({ type: 'confirm_cv_upload' });
  });
  flow.querySelector('[data-week-one-action="career-save"]')?.addEventListener('click', () => updateWeekOne({ type: 'save_career_history', answer: $('#careerAnswer').value, confirmed: $('#careerConfirmed').checked }));
  flow.querySelector('[data-week-one-action="career-confirm"]')?.addEventListener('click', () => updateWeekOne({ type: 'confirm_career', complete: true }));
  flow.querySelector('[data-week-one-action="career-add"]')?.addEventListener('click', () => updateWeekOne({ type: 'confirm_career', complete: false }));

  const statuses = journeyStepStatuses(state);
  $('#taskList').innerHTML = statuses.map(stepTaskMarkup).join('');
  wireStepReviewButtons();
  const done = statuses.filter((step) => step.status === 'completed').length;
  $('#taskCount').textContent = `${done} / ${statuses.length}`;
  const uploadButton = $('#uploadButton');
  $('#uploadButtonLabel').textContent = state.career_history.cv_uploaded ? 'Datei ändern' : '↑ Datei auswählen';
  uploadButton.classList.add('week-one-upload');
  uploadButton.classList.toggle('is-change', Boolean(state.career_history.cv_uploaded));
  $('#weekOneCvNote')?.remove();
  $('#gateNote').textContent = program.weekOneGate?.complete ? 'Alle Pflichtschritte sind abgeschlossen. Du kannst Woche 1 abschließen.' : `Die nächste Woche öffnet sich nach Abschluss aller Pflichtschritte.${program.weekOneGate?.missingRequirements?.length ? ` Offen: ${program.weekOneGate.missingRequirements.join(', ')}.` : ''}`;
  $('#completeWeek').disabled = !program.weekOneGate?.complete;
  $('#completeWeek').textContent = 'Woche abschließend beenden →';
  renderClaraJourney();
  applyWeekReadOnlyState(done === statuses.length);
}

async function updateGuidedWeek(stepAction) {
  const draftPrefix = `${program?.weekState?.current_step || 'general'}:`;
  beginClaraTurn();
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'guided_week_update', week: currentWeek, stepAction }) });
    await clearDraftKeys((key) => key.startsWith(draftPrefix)).catch(() => {});
    await loadProgram(currentWeek);
    await waitForClaraTyping();
    finishClaraTurn();
    toast('✓ Dein Schritt wurde gespeichert.');
  } catch (error) { finishClaraTurn(); toast(error.message); }
}

function renderMotivatorPrioritySelection(flow, active) {
  const draftKey = `${active.id}:priority`;
  const availableDraft = { ...(local.drafts[currentWeek] || {}), ...(program?.weekDraft || {}) };
  let selected = [];
  try {
    const parsed = JSON.parse(availableDraft[draftKey] || '[]');
    if (Array.isArray(parsed)) selected = parsed.filter((item) => MOTIVATOR_OPTIONS.includes(item)).slice(0, 5);
  } catch {}
  selected = [...new Set(selected)];
  flow.innerHTML = `<section class="motivator-priority"><header><div><p class="eyebrow">Deine persönliche Auswahl</p><h3>Was treibt dich wirklich an?</h3><p>Wähle links genau fünf Motivatoren. Rechts bringst du sie anschließend in deine Reihenfolge – Platz 1 ist dir am wichtigsten.</p></div><strong id="motivatorSelectionCount">${selected.length} / 5 gewählt</strong></header><div class="motivator-priority-board"><div class="motivator-choice-panel"><div class="motivator-panel-title"><b>Alle Motivatoren</b><small>Zum Auswählen direkt anklicken</small></div><div class="motivator-choice-grid" id="motivatorChoiceGrid"></div></div><aside class="motivator-ranking-panel"><div class="motivator-panel-title"><b>Deine Top 5</b><small>Per Pfeil oder Ziehen priorisieren</small></div><ol id="motivatorRanking" aria-label="Deine fünf Motivatoren in Prioritätsreihenfolge"></ol><div class="motivator-ranking-empty" id="motivatorRankingEmpty"><span>＋</span><p>Deine Auswahl sammelt sich hier.</p></div></aside></div><footer><p id="motivatorSelectionHint">Wähle noch fünf Motivatoren aus.</p><button type="button" class="primary" id="saveMotivatorPriority" disabled>Top 5 verbindlich speichern →</button></footer></section>`;
  const choiceGrid = flow.querySelector('#motivatorChoiceGrid');
  const ranking = flow.querySelector('#motivatorRanking');
  const empty = flow.querySelector('#motivatorRankingEmpty');
  const count = flow.querySelector('#motivatorSelectionCount');
  const hint = flow.querySelector('#motivatorSelectionHint');
  const save = flow.querySelector('#saveMotivatorPriority');
  let draggedIndex = null;
  const persistSelection = () => queueDraftValue(draftKey, JSON.stringify(selected));
  const renderSelection = () => {
    choiceGrid.innerHTML = MOTIVATOR_OPTIONS.map((motivator) => `<button type="button" class="${selected.includes(motivator) ? 'selected' : ''}" data-motivator-choice="${escapeHtml(motivator)}" aria-pressed="${selected.includes(motivator)}"><span>${selected.includes(motivator) ? '✓' : '+'}</span>${escapeHtml(motivator)}</button>`).join('');
    ranking.innerHTML = selected.map((motivator, index) => `<li draggable="true" data-motivator-rank="${index}"><b>${index + 1}</b><span>${escapeHtml(motivator)}</span><div><button type="button" data-rank-up="${index}" aria-label="${escapeHtml(motivator)} höher priorisieren" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-rank-down="${index}" aria-label="${escapeHtml(motivator)} niedriger priorisieren" ${index === selected.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-rank-remove="${index}" aria-label="${escapeHtml(motivator)} entfernen">×</button></div></li>`).join('');
    empty.hidden = selected.length > 0;
    count.textContent = `${selected.length} / 5 gewählt`;
    count.classList.toggle('complete', selected.length === 5);
    hint.textContent = selected.length === 5 ? 'Passt die Reihenfolge? Dann kannst du deine Top 5 speichern.' : `Wähle noch ${5 - selected.length} ${selected.length === 4 ? 'Motivator' : 'Motivatoren'} aus.`;
    save.disabled = selected.length !== 5;
    choiceGrid.querySelectorAll('[data-motivator-choice]').forEach((button) => button.addEventListener('click', () => {
      const motivator = button.dataset.motivatorChoice;
      if (selected.includes(motivator)) selected = selected.filter((item) => item !== motivator);
      else if (selected.length < 5) selected.push(motivator);
      else { toast('Du hast bereits fünf Motivatoren gewählt. Entferne zuerst einen aus deiner Top 5.'); return; }
      persistSelection();
      renderSelection();
    }));
    ranking.querySelectorAll('[data-rank-up]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.rankUp);
      [selected[index - 1], selected[index]] = [selected[index], selected[index - 1]];
      persistSelection(); renderSelection();
    }));
    ranking.querySelectorAll('[data-rank-down]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.rankDown);
      [selected[index], selected[index + 1]] = [selected[index + 1], selected[index]];
      persistSelection(); renderSelection();
    }));
    ranking.querySelectorAll('[data-rank-remove]').forEach((button) => button.addEventListener('click', () => {
      selected.splice(Number(button.dataset.rankRemove), 1);
      persistSelection(); renderSelection();
    }));
    ranking.querySelectorAll('[data-motivator-rank]').forEach((item) => {
      item.addEventListener('dragstart', () => { draggedIndex = Number(item.dataset.motivatorRank); item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { draggedIndex = null; item.classList.remove('dragging'); });
      item.addEventListener('dragover', (event) => event.preventDefault());
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        const targetIndex = Number(item.dataset.motivatorRank);
        if (draggedIndex === null || draggedIndex === targetIndex) return;
        const [moved] = selected.splice(draggedIndex, 1);
        selected.splice(targetIndex, 0, moved);
        persistSelection(); renderSelection();
      });
    });
  };
  save.addEventListener('click', () => updateGuidedWeek({ type: 'save_answer', stepId: active.id, answer: selected.map((item, index) => `${index + 1}. ${item}`).join('\n'), items: selected }));
  renderSelection();
}

function renderGuidedWeek() {
  const state = program.weekState;
  const definition = guidedWeekDefinition(currentWeek);
  if (!state || !definition) return;
  const active = currentGuidedStep(state);
  const clarityPending = needsGuidedClarityCheckin(state);
  const displayedStep = clarityPending ? guidedClarityStep(state) : active;
  $('#activeWeek').classList.toggle('motivator-priority-step', active?.kind === 'priority_selection' && !clarityPending);
  $('#activeWeek').classList.remove('entry-step');
  $('#activeWeek').dataset.journeyStep = displayedStep?.kind || 'review';
  $('#answerForm').classList.add('hidden');
  $('#savedAnswer').classList.add('hidden');
  $('#questionLabel').textContent = '';
  $('#questionText').textContent = displayedStep?.title || 'Woche geschafft';
  $('#questionHelp').textContent = '';
  $('#weekOneFlow')?.remove();
  let flow = $('#guidedWeekFlow');
  if (!flow) {
    flow = document.createElement('div');
    flow.id = 'guidedWeekFlow';
    $('#answerForm').before(flow);
  }
  if (clarityPending) {
    const previous = (program.clarityHistory || []).filter((item) => Number(item.week) < currentWeek && Number.isInteger(Number(item.score)) && Number(item.score) >= 1 && Number(item.score) <= 10).at(-1);
    flow.innerHTML = `<section class="weekly-clarity-checkin"><div class="weekly-clarity-intro"><span>${String(currentWeek).padStart(2, '0')}</span><div><strong>Kurzer Check-in zum Wochenstart</strong><p>Bevor es inhaltlich weitergeht: Hat sich seit der letzten Woche etwas verändert?</p>${previous ? `<small>Dein letzter Wert: <b>${Number(previous.score)} von 10</b></small>` : ''}</div></div><div class="weekly-change-choice" role="group" aria-label="Hat sich etwas verändert?"><button type="button" data-clarity-change="true">Ja, ich merke eine Veränderung</button><button type="button" data-clarity-change="false">Nein, noch nicht</button></div><div class="weekly-clarity-question"><strong>Wie klar ist dir heute, was dein Ding ist?</strong><small>1 bedeutet „noch völlig unklar“, 10 bedeutet „sehr klar“.</small></div><div class="clarity-scale weekly" role="group" aria-label="Aktueller Klarheitswert">${Array.from({ length: 10 }, (_, index) => `<button type="button" data-weekly-clarity-score="${index + 1}">${index + 1}</button>`).join('')}</div><label class="weekly-clarity-note"><span>Was hat sich verändert? <small>(optional)</small></span><textarea id="weeklyClarityNote" maxlength="3000" placeholder="Ein Gedanke oder eine kurze Beobachtung …"></textarea></label><button type="button" class="primary weekly-clarity-save" id="saveWeeklyClarity" disabled>Check-in speichern →</button><p class="week-one-error" id="weeklyClarityError"></p></section>`;
    const clarityDraftPrefix = `${state.current_step || 'general'}:`;
    const savedChange = (program.weekDraft || {})[`${clarityDraftPrefix}clarity-change`];
    const savedScore = (program.weekDraft || {})[`${clarityDraftPrefix}clarity-score`];
    let selectedChange = savedChange === 'true' ? true : savedChange === 'false' ? false : null;
    let selectedScore = /^([1-9]|10)$/.test(savedScore || '') ? Number(savedScore) : null;
    const updateSaveState = () => { $('#saveWeeklyClarity').disabled = selectedChange === null || selectedScore === null; };
    flow.querySelectorAll('[data-clarity-change]').forEach((button) => button.addEventListener('click', () => {
      selectedChange = button.dataset.clarityChange === 'true';
      flow.querySelectorAll('[data-clarity-change]').forEach((item) => item.classList.toggle('selected', item === button));
      queueDraftValue(`${clarityDraftPrefix}clarity-change`, selectedChange);
      updateSaveState();
    }));
    flow.querySelectorAll('[data-weekly-clarity-score]').forEach((button) => button.addEventListener('click', () => {
      selectedScore = Number(button.dataset.weeklyClarityScore);
      flow.querySelectorAll('[data-weekly-clarity-score]').forEach((item) => item.classList.toggle('selected', item === button));
      queueDraftValue(`${clarityDraftPrefix}clarity-score`, selectedScore);
      updateSaveState();
    }));
    flow.querySelectorAll('[data-clarity-change]').forEach((button) => button.classList.toggle('selected', selectedChange !== null && (button.dataset.clarityChange === 'true') === selectedChange));
    flow.querySelectorAll('[data-weekly-clarity-score]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.weeklyClarityScore) === selectedScore));
    updateSaveState();
    $('#saveWeeklyClarity').addEventListener('click', () => updateGuidedWeek({ type: 'save_clarity_checkin', stepId: 'weekly_clarity', score: selectedScore, changed: selectedChange, note: $('#weeklyClarityNote').value }));
  } else if (!active) {
    flow.innerHTML = '<div class="week-one-review"><span>✓</span><p>Alle Schritte dieser Woche sind abgeschlossen.</p></div>';
  } else if (active.kind === 'upload') {
    flow.innerHTML = `<div class="journey-upload"><div class="journey-upload-copy"><span>⇧</span><div><strong>${escapeHtml(active.title)}</strong><small>${escapeHtml(active.question)}</small></div></div><label class="journey-upload-action" for="fileInput">↑ Datei auswählen</label><small class="journey-upload-meta">PDF, DOCX, JPG oder PNG · maximal 10 MB</small></div>`;
  } else if (active.kind === 'scale') {
    flow.innerHTML = `<div class="clarity-scale" role="group" aria-label="Klarheitswert">${Array.from({ length: active.max - active.min + 1 }, (_, index) => `<button type="button" data-guided-score="${active.min + index}">${active.min + index}</button>`).join('')}</div>`;
    flow.querySelectorAll('[data-guided-score]').forEach((button) => button.addEventListener('click', () => updateGuidedWeek({ type: 'save_answer', stepId: active.id, score: Number(button.dataset.guidedScore), answer: button.dataset.guidedScore })));
  } else if (active.kind === 'priority_selection') {
    renderMotivatorPrioritySelection(flow, active);
  } else if (active.kind === 'external') {
    flow.innerHTML = `<div class="cv-required-card"><span class="cv-required-icon">◇</span><div><strong>${escapeHtml(active.title)}</strong><small>Dieser Schritt wird sicher geprüft. Sobald die Bestätigung vorliegt, kannst du hier direkt weitermachen.</small></div></div><button type="button" class="secondary technical-refresh" id="refreshTechnicalStep">Status prüfen</button>`;
    flow.querySelector('#refreshTechnicalStep').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try { await loadProgram(currentWeek); toast('Der aktuelle Status wurde geladen.'); }
      catch (error) { toast(error.message); }
    });
  } else {
    flow.innerHTML = '';
  }

  const statuses = guidedStepStatuses(state);
  $('#taskList').innerHTML = statuses.map(stepTaskMarkup).join('');
  wireStepReviewButtons();
  const completedSteps = statuses.filter((item) => item.status === 'completed').length;
  $('#taskCount').textContent = `${completedSteps} / ${statuses.length}`;
  $('#uploadButton').classList.add('week-one-upload');
  $('#gateNote').textContent = program.weekGate?.complete ? `Alle Pflichtschritte in Woche ${currentWeek} sind abgeschlossen.` : '';
  $('#completeWeek').disabled = !program.weekGate?.complete;
  $('#completeWeek').textContent = currentWeek === 8 ? 'Prozess abschließend beenden →' : 'Woche abschließend beenden →';
  $('#claraJourney').classList.toggle('hidden', clarityPending || ['upload', 'scale', 'external', 'priority_selection'].includes(active?.kind));
  renderClaraJourney();
  applyWeekReadOnlyState(completedSteps === statuses.length);
}

function render() {
  if (!program) return;
  const pct = progressPercent();
  const started = program.onboardingComplete;
  const content = currentContent;
  const paused = program.access.status === 'paused';
  const activeView = document.querySelector('aside nav button.active')?.dataset.view || 'onboarding';
  const reviewingOnboarding = activeView === 'onboarding';
  const showOnboarding = reviewingOnboarding;
  const showPreOnboarding = !started && activeView === 'today';
  const showDashboard = started && !showOnboarding && activeView === 'today' && todayMode === 'dashboard';
  const canonicalWeek = activeProcessWeek(program.access);
  const canonicalSummary = (program.programWeeks || []).find((item) => Number(item.week) === canonicalWeek);
  const currentClarity = currentClarityMeasurement();
  document.querySelector('aside nav button[data-view="today"] span').textContent = 'Mein Bereich';
  document.querySelector('aside nav button[data-view="onboarding"] span').textContent = started ? 'Onboarding ✓' : 'Onboarding';
  $('#sideProgress').style.width = `${pct}%`;
  $('#sidePercent').textContent = `${pct} % abgeschlossen`;
  $('#sidePhase').textContent = !showOnboarding && started ? `Woche ${canonicalWeek} · ${canonicalSummary?.title || 'Dein Prozess'}` : 'Onboarding';
  $('#sideClarityValue').textContent = `${currentClarity?.score || '—'} / 10`;
  $('#headerClarity').textContent = `Klarheit ${currentClarity?.score || '—'} / 10`;
  $('#headerPhase').textContent = !showOnboarding && started ? `Woche ${canonicalWeek} von 8 · ${canonicalSummary?.title || 'Dein Prozess'}` : 'Onboarding';
  renderProgressCelebration();
  const name = program.profile?.name || 'Teilnehmer';
  if (adminPreviewMode) {
    $('#adminPreviewCustomer').textContent = name;
    $('#adminResetOnboarding').disabled = false;
    $('#adminResetOnboarding').textContent = 'Onboarding zurücksetzen';
  }
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  $('#portalProfileAvatar').innerHTML = customerWorkspace?.profile?.photoUrl ? `<img src="${escapeHtml(customerWorkspace.profile.photoUrl)}" alt="Dein Profilbild">` : escapeHtml(initials);
  document.querySelector('.portal-profile strong').textContent = name;
  document.querySelector('.portal-profile small').textContent = program.access.fullProgramAccess ? 'Demo-Zugang · alle Wochen offen' : 'Teilnehmer · Foto ändern';
  $('#onboarding').classList.toggle('hidden', !showOnboarding);
  $('#preOnboardingDashboard').classList.toggle('hidden', !showPreOnboarding);
  $('#programDashboard').classList.toggle('hidden', !showDashboard);
  $('#activeWeek').classList.toggle('hidden', showOnboarding || showPreOnboarding || showDashboard || !started || !content);
  $('.welcome').classList.toggle('week-hero-compact', Boolean(
    started
    && !showOnboarding
    && !showDashboard
    && currentWeek === 1
    && program.weekOne?.current_step !== 'WEEK_1_ENTRY'
  ));
  renderPausedState();

  if (showOnboarding) {
    $('#mobileWeekGreeting').classList.add('hidden');
    $('#onboarding').classList.toggle('is-complete', started);
    $('#onboarding').setAttribute('aria-readonly', String(started));
    $('#onboardingCompleteState').classList.toggle('hidden', !started);
    $('#onboarding .start-gates>h2').textContent = started ? 'Dein abgeschlossenes Onboarding' : 'Drei Dinge noch, dann starten wir.';
    $('#todayLabel').textContent = started ? 'Onboarding abgeschlossen' : paused ? 'Programm pausiert' : 'Dein Start';
    $('#welcomeTitle').innerHTML = 'Willkommen bei <em>Finde dein Ding.</em>';
    $('#welcomeCopy').innerHTML = paused
      ? 'Dein Zugang ist pausiert. Bitte wende dich an Markus.'
      : 'Clara begleitet dich Frage für Frage. Du brauchst noch keine fertigen Antworten – nur die Bereitschaft, ehrlich hinzuschauen.';
    $('#clarityValue').textContent = '—';
    $('#startProcess').classList.toggle('hidden', started);
    $('#revokePrivacy').classList.add('hidden');
    if (started) $('#privacy').checked = true;
    renderOnboardingState(started);
    if (started) setGateStatus('#commitmentGateStatus', true);
    $('#startProcess').disabled = paused || $('#startProcess').disabled;
  } else if (showPreOnboarding) {
    $('#mobileWeekGreeting').classList.add('hidden');
    $('#revokePrivacy').classList.add('hidden');
    $('#todayLabel').textContent = 'Mein Bereich';
    $('#welcomeTitle').innerHTML = `Hallo ${escapeHtml(name.trim().split(/\s+/)[0] || 'du')}. <em>Schön, dass du da bist.</em>`;
    $('#welcomeCopy').textContent = 'Hier findest du nach deinem Start deine persönliche Programmübersicht, deinen Fortschritt und alle kommenden Wochen.';
    $('#clarityValue').textContent = '—';
  } else if (showDashboard) {
    $('#mobileWeekGreeting').classList.add('hidden');
    $('#revokePrivacy').classList.add('hidden');
    $('#todayLabel').textContent = 'Deine Programmübersicht';
    $('#welcomeTitle').innerHTML = `Hallo ${escapeHtml(name.trim().split(/\s+/)[0] || 'du')}. <em>Hier stehst du.</em>`;
    $('#welcomeCopy').textContent = 'Dein persönlicher Acht-Wochen-Plan zeigt dir, was bereits geschafft ist, wo du gerade stehst und wann sich der nächste Bereich öffnet.';
    $('#clarityValue').textContent = currentClarity?.score || '—';
    renderProgramDashboard();
  } else if (content) {
    $('#activeWeek').classList.remove('week-read-only');
    $('#uploadButton').hidden = false;
    $('#weekAutosaveState').hidden = false;
    $('#activeWeek .week-final-note').hidden = false;
    const weekActions = $('#reopenCurrentWeek')?.closest('details');
    if (weekActions) weekActions.hidden = false;
    $('#claraJourneyForm').hidden = false;
    $('#revokePrivacy').classList.add('hidden');
    $('#todayLabel').textContent = `Woche ${currentWeek} · ${content.mode}`;
    $('#welcomeTitle').innerHTML = `${content.title}. <em>Schritt für Schritt.</em>`;
    $('#welcomeCopy').textContent = currentWeek === 1 ? 'Wir schauen, wo du heute stehst und was sich für dich verändern soll.' : `${program.access.completedWeeks.length} von 8 Wochen abgeschlossen · ${modeLabel(program.access.accessMode)}.`;
    $('#clarityValue').textContent = currentClarity?.score || '—';
    $('#clarityValue').nextElementSibling.textContent = 'Klarheit / 10';
    $('#claraContext').textContent = `Woche ${currentWeek} · ${content.mode}`;
    $('#mobileWeekGreeting').classList.remove('hidden');
    $('#mobileGreetingTitle').textContent = `Hallo ${name.trim().split(/\s+/)[0] || 'du'}, jetzt geht’s richtig los.`;
    $('#mobileGreetingCopy').textContent = `Clara begleitet dich jetzt Schritt für Schritt durch deine ${currentWeek === 1 ? 'erste Woche' : `Woche ${currentWeek}`}.`;
    if (currentWeek === 1) renderWeekOne();
    else if (program.weekState) renderGuidedWeek();
    else {
      $('#claraJourney')?.classList.add('hidden');
      $('#weekOneFlow')?.remove();
      $('#weekOneCvNote')?.remove();
      $('#answerForm').classList.remove('hidden');
      $('#uploadButton').classList.remove('week-one-upload');
      $('#uploadButton').classList.remove('is-change');
      $('#questionText').textContent = content.question;
      $('#questionHelp').textContent = content.help;
      const answer = local.answers[currentWeek];
      $('#answer').value = '';
      $('#savedAnswer').classList.toggle('hidden', !answer);
      $('#savedAnswer').textContent = answer ? '✓ Deine Antwort wurde gespeichert.' : '';
      $('#taskList').innerHTML = content.tasks.map((task) => `<label class="task ${task.completed ? 'completed' : ''}"><input type="checkbox" data-gate="${task.id}" ${task.completed ? 'checked' : ''} ${paused ? 'disabled' : ''}><span><b>${task.label}</b><small>Pflichtaufgabe · serverseitig bestätigt</small></span></label>`).join('');
      $$('[data-gate]').forEach((input) => input.addEventListener('change', async () => {
        input.disabled = true;
        try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'set_gate', week: currentWeek, gateId: input.dataset.gate, completed: input.checked }) }); await loadProgram(currentWeek); }
        catch (error) { input.checked = !input.checked; input.disabled = false; toast(error.message); }
      }));
      const done = content.tasks.filter((task) => task.completed).length;
      $('#taskCount').textContent = `${done} / ${content.tasks.length}`;
      $('#uploadButtonLabel').textContent = `↑ ${content.upload}`;
      $('#completeWeek').disabled = paused || done < content.tasks.length;
      $('#completeWeek').textContent = currentWeek === 8 ? 'Prozess abschließend beenden →' : 'Woche abschließend beenden →';
      $('#gateNote').textContent = 'Weitere Wochen öffnen sich automatisch alle sieben Tage ab deinem Projektstart.';
    }
  }
  renderJourney(); renderInsights(); renderDocuments();
  renderLockedViewNotice();
  wireSpeechControls();
  restoreWeekDraft();
}

function renderJourney() {
  const summaries = new Map((program?.programWeeks || []).map((week) => [week.week, week]));
  $('#journeyGrid').innerHTML = (program?.access.weekStates || []).map((state) => {
    const summary = summaries.get(state.week);
    const active = state.week === currentWeek;
    const status = state.completed ? '✓ abgeschlossen' : active ? '● geöffnet' : state.accessible ? '○ verfügbar' : 'gesperrt';
    const reason = state.reason === 'demo_full_access' ? 'Im Demo-Modus sofort verfügbar' : state.reason === 'admin_unlocked' ? 'Vom Admin freigegeben' : state.reason === 'admin_locked' ? 'Vom Admin gesperrt' : state.reason === 'scheduled_release' ? `Freigeschaltet seit ${formatProgramDate(state.unlocksAt)}` : state.reason === 'scheduled_wait' ? `Öffnet am ${formatProgramDate(state.unlocksAt)}` : state.accessible ? 'Zugriff freigegeben' : 'Noch nicht freigeschaltet';
    return `<article class="week-card ${state.completed ? 'completed' : active ? 'active' : state.accessible ? 'available' : 'locked'}" data-preview-week="${state.week}" tabindex="0" role="button"><span>Woche ${state.week}</span><i>${status}</i><h2>${escapeHtml(summary?.title || `Woche ${state.week}`)}</h2><p>${escapeHtml(summary?.description || summary?.mode || 'Dein nächster Schritt im Acht-Wochen-Prozess.')}</p><b>${reason} · Details ansehen</b></article>`;
  }).join('');
  $$('#journeyGrid [data-preview-week]').forEach((card) => {
    const week=Number(card.dataset.previewWeek),hasReflection=(program?.weekReflections||[]).some(item=>Number(item.week)===week);
    card.addEventListener('click', () => hasReflection?openWeekReflection(week):openWeekPreview(week));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault();hasReflection?openWeekReflection(week):openWeekPreview(week); } });
  });
  renderWeekReflections();
}

function renderWeekReflections() {
  const target = $('#weekReflectionList');
  if (!target) return;
  const reflections = program?.weekReflections || [];
  target.innerHTML = reflections.length
    ? reflections.map((reflection) => `<button type="button" class="week-reflection-card" data-reflection-week="${reflection.week}"><span>Woche ${reflection.week} · freigeschaltet</span><strong>${escapeHtml(reflection.title || `Wochenreflexion ${reflection.week}`)}</strong><p>${escapeHtml(reflection.summary || '')}</p><b>Reflexion vollständig lesen →</b></button>`).join('')
    : '<div class="week-reflection-empty"><span>◇</span><div><strong>Noch keine Reflexion freigeschaltet</strong><p>Beende deine laufende Woche final. Danach findest du Claras Zusammenfassung genau hier.</p></div></div>';
  target.querySelectorAll('[data-reflection-week]').forEach((button) => button.addEventListener('click', () => openWeekReflection(Number(button.dataset.reflectionWeek))));
}

function renderInsights() {
  const motivators = program?.profile?.programInsights?.motivators || [];
  $('#motivatorTags').innerHTML = motivators.length ? motivators.map((item, index) => `<span class="tag"><b>${index + 1}</b>${escapeHtml(item)}</span>`).join('') : '<i>Entwickelt sich in Woche 3</i>';
  const values = program.access.completedWeeks.includes(5) ? ['Eigenverantwortung', 'Ehrlichkeit', 'Entwicklung'] : [];
  $('#valueTags').innerHTML = values.length ? values.map((item) => `<span class="tag">${item}</span>`).join('') : '<i>Öffnet sich in Woche 5</i>';
  const measurements = (program?.clarityHistory || []).filter((item) => Number.isInteger(Number(item.score)) && Number(item.score) >= 1 && Number(item.score) <= 10);
  const first = measurements[0];
  const latest = measurements.at(-1);
  $('#clarityChart').innerHTML = `<b>Start ${first?.score || '—'}</b><i></i><b>Heute ${latest?.score || '—'}</b>`;
}

function renderDocuments() {
  const articles = $$('#documentList article');
  if (program.onboardingComplete) { articles[0].classList.remove('locked'); articles[0].querySelector('small').textContent = 'Digital bestätigt'; articles[0].querySelector('i').textContent = 'Erledigt'; }
  [[4, 1, 'Bereit'], [6, 2, 'Bereit'], [8, 3, 'Wird erzeugt']].forEach(([week, index, label]) => { if (program.access.completedWeeks.includes(week)) { articles[index].classList.remove('locked'); articles[index].querySelector('i').textContent = label; } });
  $$('#documentList .customer-record-doc').forEach((item) => item.remove());
  const documents = [...(customerWorkspace?.documents || [])];
  const privacyDocumentId = program?.onboarding?.privacyDocumentId;
  const commitmentDocumentId = program?.onboarding?.commitmentDocumentId;
  if (privacyDocumentId && !documents.some((document) => document.id === privacyDocumentId)) documents.unshift({ id: privacyDocumentId, week: 0, document_type: 'privacy_consent', display_title: 'Datenschutzinformation & Einwilligung', source: 'system', visibility: 'customer', processing_status: 'ready' });
  if (commitmentDocumentId && !documents.some((document) => document.id === commitmentDocumentId)) documents.unshift({ id: commitmentDocumentId, week: 0, document_type: 'start_commitment', display_title: 'Mein persönliches Commitment', source: 'system', visibility: 'customer', processing_status: 'ready' });
  articles[0].classList.toggle('hidden', documents.some((document) => document.document_type === 'start_commitment'));
  const official = (customerWorkspace?.contracts || []).flatMap((contract) => [{ title: contract.title || 'Vertragsdokument', ready: Boolean(contract.document_confirmed_at), label: 'Vertrag' }, { title: `Videovertrag · ${contract.title || 'Vertragsabschluss'}`, ready: Boolean(contract.video_contract_confirmed_at), label: 'Videovertrag' }]);
  const uploaded = documents.map((document) => ({ title: document.display_title || document.original_file_name, ready: true, label: document.document_type === 'privacy_consent' ? 'Digital bestätigte Datenschutzeinwilligung' : document.document_type === 'start_commitment' ? 'Digital bestätigtes persönliches Commitment' : document.source === 'customer' ? 'Von dir hochgeladen' : 'Für dich bereitgestellt', document }));
  $('#documentList').insertAdjacentHTML('beforeend', [...official, ...uploaded].map((item) => `<article class="customer-record-doc ${item.ready ? '' : 'locked'} ${item.document ? 'is-previewable' : ''}"${item.document ? ` data-document-preview data-document-id="${escapeHtml(item.document.id)}" data-document-title="${escapeHtml(item.title)}" data-document-file="${escapeHtml(item.document.original_file_name || `${item.title}.pdf`)}" data-document-mime="${escapeHtml(item.document.mime_type || 'application/pdf')}" tabindex="0" role="button" aria-haspopup="dialog"` : ''}><span>▤</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.label)}</small></div>${item.document ? '<button type="button" class="document-preview-open">Ansehen ↗</button>' : `<i>${item.ready ? 'Bestätigt' : 'Offen'}</i>`}</article>`).join(''));
}

function openDocumentPreviewFromElement(element) {
  openDocumentPreview({ id: element.dataset.documentId, title: element.dataset.documentTitle, fileName: element.dataset.documentFile, mimeType: element.dataset.documentMime });
}

$('#documentList').addEventListener('click', (event) => {
  const item = event.target.closest('[data-document-preview]');
  if (item) openDocumentPreviewFromElement(item);
});
$('#documentList').addEventListener('keydown', (event) => {
  const item = event.target.closest('[data-document-preview]');
  if (!item || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  openDocumentPreviewFromElement(item);
});

function renderPortalAppointments() {
  const target = $('#portalAppointmentList');
  if (!target) return;
  const appointments = customerWorkspace?.appointments || [], now = Date.now();
  const upcoming = appointments.filter((item) => item.status === 'scheduled' && new Date(item.starts_at).getTime() >= now);
  const past = appointments.filter((item) => !upcoming.includes(item)).slice().reverse();
  const group = (title, items) => `<section><h2>${title}</h2>${items.length ? items.map((item) => `<article><time><b>${new Date(item.starts_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}</b><span>${new Date(item.starts_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</span></time><div><strong>${escapeHtml(item.title || 'Kundentermin')}</strong><p>${item.status === 'cancelled' ? 'Abgesagt' : item.status === 'completed' ? 'Abgeschlossen' : 'Geplant'} · Google Kalender</p></div>${item.meet_url ? `<a href="${escapeHtml(item.meet_url)}" target="_blank" rel="noopener">Google Meet öffnen →</a>` : '<span class="portal-appointment-note">Kein Meet-Link</span>'}</article>`).join('') : '<div class="portal-appointment-empty">Keine Termine vorhanden.</div>'}</section>`;
  target.innerHTML = group('Deine nächsten Termine', upcoming) + group('Vergangene Termine', past);
}

$('#openCurrentWeek').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try { await openWeek(activeProcessWeek(program?.access)); }
  finally { button.disabled = false; }
});
$$('#clarityCheckinScale [data-clarity-dialog-score]').forEach((button) => button.addEventListener('click', () => {
  selectedClarityScore = Number(button.dataset.clarityDialogScore);
  $$('#clarityCheckinScale [data-clarity-dialog-score]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  $('#claritySelectedScore').textContent = String(selectedClarityScore);
  $('#saveClarityCheckin').disabled = false;
}));
$('#saveClarityCheckin').addEventListener('click', saveWeeklyClarityCheckin);
function leaveClarityCheckin() {
  $('#clarityCheckinDialog').close();
  document.body.classList.remove('clarity-checkin-open');
  pendingClarityWeek = null;
  todayMode = 'dashboard';
  showView('today');
}
$('#leaveClarityCheckin').addEventListener('click', leaveClarityCheckin);
$('#clarityCheckinDialog').addEventListener('cancel', (event) => { event.preventDefault(); leaveClarityCheckin(); });
$('#continueAfterClarityImprovement').addEventListener('click', (event) => {
  const week = Number(event.currentTarget.dataset.week);
  $('#clarityImprovementDialog').close();
  if (week) openWeek(week);
});
$('#clarityImprovementDialog').addEventListener('cancel', (event) => event.preventDefault());
$('#openProgressCelebration').addEventListener('click', openProgressCelebration);
$('#openProgressCelebration').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openProgressCelebration();
  }
});
$('#closeProgressCelebration').addEventListener('click', () => $('#progressCelebrationDialog').close());
$('#progressCelebrationDialog').addEventListener('click', (event) => {
  if (event.target === $('#progressCelebrationDialog')) $('#progressCelebrationDialog').close();
});
$('#progressCelebrationDialog').addEventListener('close', () => $('#progressCelebrationDialog').classList.remove('is-celebrating'));
$('#celebrationContinue').addEventListener('click', (event) => {
  const week = Number(event.currentTarget.dataset.week || 1);
  $('#progressCelebrationDialog').close();
  if (program?.access?.completedWeeks?.length === 8) showView('insights');
  else openWeek(week);
});
$('#closeStepReview').addEventListener('click', () => $('#stepReviewDialog').close());
$('#stepReviewDialog').addEventListener('click', (event) => {
  if (event.target === $('#stepReviewDialog')) $('#stepReviewDialog').close();
});
$('#closeWeekPreview').addEventListener('click', () => $('#weekPreviewDialog').close());
$('#openPreviewWeek').addEventListener('click', (event) => {
  const week = Number(event.currentTarget.dataset.previewWeek);
  if (!event.currentTarget.disabled && week) {
    $('#weekPreviewDialog').close();
    openWeek(week);
  }
});
$('#weekPreviewDialog').addEventListener('click', (event) => {
  if (event.target === $('#weekPreviewDialog')) $('#weekPreviewDialog').close();
});
$('#backToDashboard').addEventListener('click', () => {
  todayMode = 'dashboard';
  showView('today');
});
$('#openOnboarding').addEventListener('click', () => showView('onboarding'));
const onboardingBirthParts = [$('#onboardingBirthDay'), $('#onboardingBirthMonth'), $('#onboardingBirthYear')];
onboardingBirthParts.forEach((input, index) => {
  input.addEventListener('input', () => {
    const maxLength = index === 2 ? 4 : 2;
    input.value = input.value.replace(/\D/g, '').slice(0, maxLength);
    syncOnboardingBirthDate();
    if (input.value.length === maxLength && index < onboardingBirthParts.length - 1) onboardingBirthParts[index + 1].focus();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Backspace' && !input.value && index > 0) onboardingBirthParts[index - 1].focus();
  });
});
$('#onboardingBirthDay').addEventListener('paste', (event) => {
  const digits = event.clipboardData?.getData('text')?.replace(/\D/g, '') || '';
  if (digits.length !== 8) return;
  event.preventDefault();
  $('#onboardingBirthDay').value = digits.slice(0, 2);
  $('#onboardingBirthMonth').value = digits.slice(2, 4);
  $('#onboardingBirthYear').value = digits.slice(4, 8);
  syncOnboardingBirthDate();
  $('#onboardingBirthYear').focus();
  $('#onboardingBirthYear').dispatchEvent(new Event('input', { bubbles: true }));
});
function persistOnboardingProfile() {
  clearTimeout(onboardingProfileSaveTimer);
  const revision = onboardingProfileRevision;
  const payload = onboardingProfilePayload();
  onboardingProfileSaveQueue = onboardingProfileSaveQueue.catch(() => {}).then(async () => {
    $('#profileGateHint').textContent = 'Wird automatisch gespeichert …';
    const result = await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_onboarding_profile', profile: payload }) });
    onboardingProfilePersistedRevision = Math.max(onboardingProfilePersistedRevision, revision);
    if (program) {
      program.profile = { ...program.profile, ...payload };
      program.onboarding = { ...program.onboarding, profileComplete: result.profileComplete, missingProfileFields: result.missingFields || [] };
    }
    if (onboardingProfilePersistedRevision === onboardingProfileRevision) {
      onboardingProfileDirty = false;
      $('#profileGateHint').textContent = result.missingFields?.length ? `Automatisch gespeichert. Bitte noch ergänzen: ${result.missingFields.join(', ')}.` : 'Alle Pflichtangaben sind automatisch gespeichert.';
      $('#profileGateHint').classList.toggle('complete', !result.missingFields?.length);
      refreshOnboardingGateState();
    }
    customerWorkspace = null;
    return result;
  }).catch((error) => {
    $('#profileGateHint').textContent = 'Automatisches Speichern fehlgeschlagen. Bitte erneut versuchen.';
    throw error;
  });
  return onboardingProfileSaveQueue;
}
$('#onboardingProfileForm').addEventListener('input', (event) => {
  if (program?.onboardingComplete) return;
  if (onboardingBirthParts.includes(event.target)) syncOnboardingBirthDate();
  onboardingProfileDirty = true;
  onboardingProfileRevision += 1;
  $('#profileGateHint').textContent = 'Wird automatisch gespeichert …';
  markOnboardingProfileFields();
  clearTimeout(onboardingProfileSaveTimer);
  onboardingProfileSaveTimer = setTimeout(() => persistOnboardingProfile().catch(() => {}), 650);
  refreshOnboardingGateState();
});
$('#onboardingProfileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  syncOnboardingBirthDate();
  const missing = markOnboardingProfileFields();
  if (missing.length) {
    clearTimeout(onboardingProfileSaveTimer);
    $('#profileGateHint').textContent = `Bitte ergänze noch: ${missing.map((item) => item.label).join(', ')}.`;
    $('#profileGateHint').classList.remove('complete');
    document.querySelector(`[data-profile-field="${missing[0].key}"] input, [data-profile-field="${missing[0].key}"] select`)?.focus();
    toast(`Noch nicht vollständig: ${missing.map((item) => item.label).join(', ')}.`);
    return;
  }
  const button = $('#saveOnboardingProfile');
  button.disabled = true;
  button.textContent = 'Wird gespeichert …';
  try {
    await persistOnboardingProfile();
    await loadProgram();
    showView('onboarding');
    toast('Deine persönlichen Angaben wurden in deiner Kundenakte gespeichert.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Angaben speichern'; }
});
$('#openPrivacyConsent').addEventListener('click', openPrivacyConsentDialog);
$('#closePrivacyConsent').addEventListener('click', () => closePrivacyConsentDialog());
$('#cancelPrivacyConsent').addEventListener('click', () => closePrivacyConsentDialog());
$('#privacyConsentDialog').addEventListener('click', (event) => { if (event.target === $('#privacyConsentDialog')) closePrivacyConsentDialog(); });
['#privacySpecialCategories', '#privacyNoticeAccepted', '#privacyAiAccepted', '#privacyName', '#privacyPlace', '#privacyDate'].forEach((selector) => {
  $(selector).addEventListener('input', () => { schedulePrivacyPdfPreview(); queueOnboardingFormDraft('privacy_consent', currentPrivacyConsentInput()); });
  $(selector).addEventListener('change', () => { schedulePrivacyPdfPreview(); queueOnboardingFormDraft('privacy_consent', currentPrivacyConsentInput()); });
});
$('#privacyConsentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#confirmPrivacyConsent');
  button.disabled = true;
  button.textContent = 'PDF wird erstellt …';
  try {
    await prepareOnboardingFormFinalization('privacy_consent');
    await updatePrivacyPdfPreview();
    const confirmation = await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'confirm_privacy', consent: currentPrivacyConsentInput() }) });
    if (!confirmation.documentId) throw new Error('Die PDF wurde noch nicht eindeutig in deiner Dokumentenakte gespeichert. Bitte versuche es erneut.');
    customerWorkspace = customerWorkspace || {};
    customerWorkspace.documents = confirmation.document
      ? [confirmation.document, ...(customerWorkspace.documents || []).filter((document) => document.id !== confirmation.documentId)]
      : (customerWorkspace.documents || []);
    closePrivacyConsentDialog('confirmed');
    $('#privacyConsentForm').reset();
    downloadCustomerDocument(confirmation.documentId, confirmation.document?.original_file_name || 'FDD-Datenschutzeinwilligung.pdf');
    await loadProgram();
    showView('onboarding');
    toast('Deine Einwilligung wurde bestätigt, bei Dokumente gespeichert und heruntergeladen.');
  } catch (error) { onboardingFormsFinalizing.delete('privacy_consent'); toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Verbindlich bestätigen →'; }
});
$('#openCommitment').addEventListener('click', openCommitmentDialog);
$('#closeCommitmentDialog').addEventListener('click', () => closeCommitmentDialog());
$$('[data-close-commitment]').forEach((button) => button.addEventListener('click', () => closeCommitmentDialog()));
$('#commitmentDialog').addEventListener('click', (event) => { if (event.target === $('#commitmentDialog')) closeCommitmentDialog(); });
$('#commitmentBack').addEventListener('click', () => {
  commitmentWizardStep = Math.max(0, commitmentWizardStep - 1);
  renderCommitmentWizard();
  queueOnboardingFormDraft('start_commitment', currentCommitmentInput());
});
$('#commitmentNext').addEventListener('click', () => {
  if (!validateCommitmentStep()) return;
  commitmentWizardStep = Math.min(4, commitmentWizardStep + 1);
  renderCommitmentWizard();
  queueOnboardingFormDraft('start_commitment', currentCommitmentInput());
});
function handleCommitmentDraftChange() {
  queueOnboardingFormDraft('start_commitment', currentCommitmentInput());
  scheduleCommitmentPdfPreview();
}
$('#commitmentForm').addEventListener('input', handleCommitmentDraftChange);
$('#commitmentForm').addEventListener('change', handleCommitmentDraftChange);
$('#commitmentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validateCommitmentStep(4)) return;
  const button = $('#confirmCommitment');
  button.disabled = true;
  button.textContent = 'PDF wird erstellt …';
  try {
    await prepareOnboardingFormFinalization('start_commitment');
    await updateCommitmentPdfPreview();
    const confirmation = await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'confirm_commitment', commitment: currentCommitmentInput() }) });
    if (!confirmation.documentId) throw new Error('Das Commitment wurde noch nicht eindeutig in deiner Dokumentenakte gespeichert. Bitte versuche es erneut.');
    customerWorkspace = customerWorkspace || {};
    customerWorkspace.documents = confirmation.document
      ? [confirmation.document, ...(customerWorkspace.documents || []).filter((document) => document.id !== confirmation.documentId)]
      : (customerWorkspace.documents || []);
    if (program?.onboarding) {
      program.onboarding.commitmentConfirmed = true;
      program.onboarding.commitmentConfirmedAt = confirmation.confirmedAt;
      program.onboarding.commitmentDocumentId = confirmation.documentId;
      program.onboarding.commitmentFileName = confirmation.document?.original_file_name || '';
    }
    refreshOnboardingGateState();
    closeCommitmentDialog('confirmed');
    downloadCustomerDocument(confirmation.documentId, confirmation.document?.original_file_name || 'FDD-Mein-persoenliches-Commitment.pdf');
    await loadProgram();
    showView('onboarding');
    window.setTimeout(() => $('.commitment-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    toast('Dein Commitment wurde ausgefüllt, bei Dokumente gespeichert und heruntergeladen.');
  } catch (error) { onboardingFormsFinalizing.delete('start_commitment'); toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Digital bestätigen →'; }
});
$('#startProcess').addEventListener('click', async () => {
  const button = $('#startProcess');
  button.disabled = true;
  button.textContent = 'Woche 1 wird vorbereitet …';
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'start', profile: onboardingProfilePayload() }) });
    todayMode = 'dashboard';
    customerWorkspace = null;
    await loadProgram();
    showView('today');
    toast('Alles erfolgreich erledigt. Deine 8-Wochen-Übersicht ist jetzt bereit.');
  } catch (error) {
    button.textContent = 'Ich bin bereit →';
    refreshOnboardingGateState();
    toast(error.message === 'Die Anfrage konnte nicht verarbeitet werden.' ? 'Der Start konnte gerade nicht abgeschlossen werden. Bitte versuche es noch einmal.' : error.message);
  }
});
$('#revokePrivacy').addEventListener('click', async () => {
  const confirmed = window.confirm('Möchtest du deine Einwilligung zum Datenschutz wirklich widerrufen? Clara kann dich danach nicht weiter begleiten, bis du erneut einwilligst. Deine bisherigen Inhalte werden nicht gelöscht.');
  if (!confirmed) return;
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'revoke_privacy' }) });
    $('#privacy').checked = false;
    await loadProgram();
    showView('onboarding');
    toast('Deine Einwilligung wurde widerrufen.');
  } catch (error) { toast(error.message); }
});

$('#adminResetOnboarding')?.addEventListener('click', () => {
  if (!adminPreviewMode || !program) return;
  $('#adminOnboardingResetDialog').showModal();
});
$$('[data-close-admin-reset]').forEach((button) => button.addEventListener('click', () => $('#adminOnboardingResetDialog').close()));
$('#adminOnboardingResetDialog')?.addEventListener('click', (event) => { if (event.target === $('#adminOnboardingResetDialog')) $('#adminOnboardingResetDialog').close(); });
$('#confirmAdminOnboardingReset')?.addEventListener('click', async (event) => {
  if (!adminPreviewMode) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Onboarding wird zurückgesetzt …';
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'admin_reset_onboarding' }) });
    customerWorkspace = null;
    onboardingProfileDirty = false;
    todayMode = 'dashboard';
    $('#adminOnboardingResetDialog').close();
    await loadProgram();
    showView('onboarding');
    toast('Onboarding wurde zurückgesetzt. Der Kunde startet wieder vor Woche 1.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Ja, Onboarding zurücksetzen'; }
});
$('#closeAdminPreview')?.addEventListener('click', () => {
  sessionStorage.removeItem('fdd_admin_preview_token');
  window.close();
  setTimeout(() => { location.href = '/admin?view=participants'; }, 120);
});
$('#answerForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const answer = $('#answer').value.trim(); if (!answer) return;
  const savedDraftKey = draftKeyFor($('#answer'));
  beginClaraTurn();
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_answer', week: currentWeek, answer }) });
    await clearDraftKeys((key) => key === savedDraftKey).catch(() => {});
    local.answers[currentWeek] = answer;
    saveLocal();
    await loadProgram(currentWeek);
    await waitForClaraTyping();
    finishClaraTurn();
    toast('Deine Antwort wurde serverseitig gespeichert.');
  } catch (error) { finishClaraTurn(); toast(error.message); }
});
$('#claraJourneyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#claraJourneyInput');
  const button = $('#sendJourneyMessage');
  const message = input.value.trim();
  if (!message || button.disabled) return;
  const sentDraftKey = draftKeyFor(input);
  const pending = { role: 'participant', content: message, created_at: new Date().toISOString() };
  journeyMessages.push(pending);
  input.value = '';
  journeyLoading = true;
  const typingStartedAt = nowMs();
  button.disabled = true;
  button.textContent = 'Clara denkt …';
  renderClaraJourney();
  try {
    const result = await request('/api/participant-program?feature=clara-message', { method: 'POST', body: JSON.stringify({ week: currentWeek, message, clientMessageId: crypto.randomUUID() }) });
    await clearDraftKeys((key) => key === sentDraftKey).catch(() => {});
    await waitForClaraTyping(typingStartedAt);
    journeyMessages.push(result.message);
    if (currentWeek === 1) {
      program.weekOne = result.weekOne;
      program.weekOneGate = result.gate;
    } else {
      program.weekState = result.weekState;
      program.weekGate = result.gate;
    }
    currentContent.tasks = result.steps;
    journeyLoading = false;
    render();
    queueClaraStepTransition(result.transition);
  } catch (error) {
    journeyMessages = journeyMessages.filter((item) => item !== pending);
    input.value = message;
    renderClaraJourney();
    toast(error.message);
  } finally {
    journeyLoading = false;
    button.disabled = false;
    button.textContent = 'Senden →';
    renderClaraJourney();
  }
});

$('#claraNextStep')?.addEventListener('click', () => revealNextClaraStep());

$('#claraJourneyInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!$('#sendJourneyMessage').disabled) $('#claraJourneyForm').requestSubmit();
});

$('#activeWeek').addEventListener('input', (event) => {
  const control = event.target.closest('textarea, input[type="text"]');
  if (control) queueDraftSave(control);
});

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

$('#portalProfilePhotoButton').addEventListener('click', () => $('#portalProfilePhotoInput').click());
$('#portalProfilePhotoInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { toast('Das Profilbild darf höchstens 3 MB groß sein.'); event.target.value = ''; return; }
  try {
    const result = await request('/api/customer-records?action=avatar-upload', { method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, contentBase64: await fileAsBase64(file) }) });
    customerWorkspace = { ...(customerWorkspace || {}), profile: { ...(customerWorkspace?.profile || {}), photoUrl: result.photoUrl } };
    render();
    toast('Dein Profilbild wurde gespeichert.');
  } catch (error) { toast(error.message); }
  event.target.value = '';
});

$('#fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (currentWeek === 1) {
    if (file.size > 10 * 1024 * 1024) { toast('Der Lebenslauf darf höchstens 10 MB groß sein.'); event.target.value = ''; return; }
    try {
      toast('Dein Lebenslauf wird sicher gespeichert und gelesen …');
      const uploaded = await request('/api/participant-program?feature=participant-document', { method: 'POST', body: JSON.stringify({ week: 1, documentType: 'cv', fileName: file.name, mimeType: file.type, contentBase64: await fileAsBase64(file) }) });
      local.uploads[1] = { id: uploaded.document.id, name: file.name, type: file.type, size: file.size, at: new Date().toISOString(), status: uploaded.document.status };
      saveLocal();
      await updateWeekOne({ type: 'cv_uploaded', fileName: file.name, fileId: uploaded.document.id, storagePath: uploaded.document.storagePath, stations: uploaded.document.extractedData?.stations || [] });
      if (uploaded.document.status === 'needs_ocr') toast('Das Dokument ist vermutlich gescannt. Es wurde für die OCR-Verarbeitung vorgemerkt.');
      else if (uploaded.document.status === 'failed') toast('Dein Lebenslauf wurde sicher gespeichert. Die automatische Auswertung wird später erneut versucht.');
    } catch (error) { toast(error.message); }
    event.target.value = '';
    return;
  }
  const active = currentGuidedStep(program.weekState);
  if (!active || active.kind !== 'upload') return;
  if (file.size > 10 * 1024 * 1024) { toast('Das Dokument darf höchstens 10 MB groß sein.'); event.target.value = ''; return; }
  try {
    toast('Dein Dokument wird sicher gespeichert …');
    const uploaded = await request('/api/participant-program?feature=participant-document', { method: 'POST', body: JSON.stringify({ week: currentWeek, documentType: active.documentType || 'workbook', fileName: file.name, mimeType: file.type, contentBase64: await fileAsBase64(file) }) });
    local.uploads[currentWeek] = { id: uploaded.document.id, stepId: active.id, name: file.name, type: file.type, size: file.size, at: new Date().toISOString(), status: uploaded.document.status };
    saveLocal();
    await updateGuidedWeek({ type: 'document_uploaded', stepId: active.id, documentId: uploaded.document.id, fileName: file.name });
  } catch (error) { toast(error.message); }
  event.target.value = '';
});
$('#reopenCurrentWeek').addEventListener('click', () => openWeekActionDialog('reset'));
$('#completeWeek').addEventListener('click', () => openWeekActionDialog('complete'));
$('#saveSupport').addEventListener('click', async () => {
  const text = $('#supportText').value.trim();
  if (!text) return;
  const button = $('#saveSupport');
  button.disabled = true;
  try {
    const result = await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'support_question', week: currentWeek, question: text }) });
    local.support.push({ id: result.question?.id, text, week: currentWeek, at: result.question?.created_at || new Date().toISOString() });
    $('#supportText').value = '';
    saveLocal();
    toast('Deine Frage wurde an Markus übermittelt.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#customerLogout').addEventListener('click', async () => {
  if (adminPreviewMode) {
    sessionStorage.removeItem('fdd_admin_preview_token');
    location.replace('/admin?view=participants');
    return;
  }
  await fetch('/api/auth?action=session', { method: 'DELETE' });
  location.replace('/login');
});

loadProgram().catch((error) => { if (error.status === 401) location.replace('/kunden-login'); else toast(error.message); });
