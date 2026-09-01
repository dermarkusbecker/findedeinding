import { stepStatuses, weekOnePrompt } from './lib/week-one.js';

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
const local = { ...rawLocal, answers: rawLocal.answers || {}, uploads: rawLocal.uploads || {}, support: rawLocal.support || [], signedCommitment: rawLocal.signedCommitment || null };
if (local.signedCommitment?.flowVersion !== 2) {
  local.signedCommitment = null;
  localStorage.setItem('fdd_customer_notes', JSON.stringify(local));
}
let program = null;
let currentWeek = 1;
let currentContent = null;
let initialViewResolved = false;
let claraMessages = [];
const speechState = { recognition: null, activeButton: null };

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

$$('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewLink)));
wireSpeechControls();
window.wireSpeechControls = wireSpeechControls;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers });
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = {}; }
  if (!response.ok) { const error = new Error(data.error || 'Die Anfrage konnte nicht verarbeitet werden.'); error.status = response.status; error.data = data; throw error; }
  return data;
}

function modeLabel(mode) {
  return mode === 'time_based' ? 'Zeitbasierte Freischaltung' : mode === 'full_access' ? 'Alles freigegeben' : 'Abschlussbasierte Freischaltung';
}


function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function buildStartCommitmentText(name = 'Teilnehmer') {
  return `
    <div class="commitment-title">Mein Start-Commitment</div>
    <p><strong>${escapeHtml(name)}</strong></p>
    <p>Ich entscheide mich bewusst, mich auf Finde dein Ding einzulassen.</p>
    <p>Ich bin bereit, ehrlich hinzuschauen – auch wenn eine Antwort noch unfertig, unbequem oder widersprüchlich ist – und dranzubleiben.</p>
    <p>Ich möchte meine Entscheidung nicht nur denken, sondern sie konkret erleben, prüfen und mit Verantwortung weiterentwickeln.</p>
    <p>Ich bestätige hiermit bewusst mein persönliches Commitment für den Start dieses Prozesses.</p>
    <div class="commitment-signature"><span>Ort, Datum</span><span>__________________</span></div>
    <div class="commitment-signature"><span>Name</span><span>${escapeHtml(name)}</span></div>
    <div class="commitment-signature"><span>Unterschrift</span><span>__________________</span></div>
  `;
}

async function openCommitmentPrintView() {
  const pdfCss = `
    * { box-sizing: border-box; }
    @page { size: A4; margin: 0; }
    body { margin: 0; background: #eceeed; color: #111; font-family: Georgia, "Times New Roman", serif; }
    .pdf-sheet { position: relative; width: 595px; height: 842px; margin: 0 auto; padding: 44px 68px 48px; overflow: hidden; background: #fff; page-break-after: always; }
    .pdf-sheet:last-child { page-break-after: auto; }
    .brand-title { margin: 0 0 8px; color: #f5a36f; font-size: 27px; line-height: 1; font-weight: 800; letter-spacing: -.02em; }
    .document-title { margin: 0 0 17px; font-size: 15px; line-height: 1.2; font-weight: 800; text-transform: uppercase; }
    .intro-box, .signature-box { padding: 11px 10px; background: #f0f2f1; }
    .intro-box { margin: 0 -10px 21px; }
    .intro-box strong, .signature-box strong { display: block; margin-bottom: 6px; font-size: 10.5px; }
    .intro-box p, .signature-box p { margin: 0; font-size: 10.5px; line-height: 1.65; }
    .meta-row { display: flex; gap: 8px; margin: 0 0 19px; font-size: 10px; }
    .meta-row strong { min-width: 74px; }
    .meta-row span { display: inline-block; width: 210px; border-bottom: 1px solid #444; }
    .write-section { margin-top: 31px; }
    .write-section h2, .page-two h2 { margin: 0 0 8px; color: #111; font-size: 14px; line-height: 1.25; font-weight: 800; text-transform: uppercase; }
    .write-section.cost h2, .page-two h2 { color: #314d42; }
    .write-section p { margin: 0 0 14px; font-size: 10.5px; }
    .writing-lines { display: grid; gap: 19px; }
    .writing-lines i { display: block; border-bottom: 1px solid #555; }
    .footer { position: absolute; bottom: 35px; left: 0; width: 100%; color: #9a9a96; font-size: 7px; text-align: center; }
    .footer b { margin-left: 8px; color: #111; font-size: 9px; }
    .page-two { padding: 57px 69px 48px; }
    .page-two .commitment-list { margin: 0 0 30px; padding: 0 0 0 6px; list-style: none; }
    .page-two .commitment-list li { position: relative; margin: 0 0 4px; padding-left: 8px; font-size: 10px; line-height: 1.35; }
    .page-two .commitment-list li::before { content: "•"; position: absolute; left: 0; }
    .signature-box { margin: 22px -9px 25px; padding: 11px 9px; }
    .signature-line { display: flex; align-items: flex-end; gap: 5px; margin: 0 0 35px; font-size: 10px; font-weight: 700; }
    .signature-line i { display: inline-block; width: 164px; border-bottom: 1px solid #333; }
    .closing-brand { position: absolute; left: 0; right: 0; bottom: 113px; text-align: center; }
    .closing-brand strong { display: block; color: #f5a36f; font-size: 22px; line-height: 1; }
    .closing-brand span { display: block; margin-top: 19px; font-family: Arial, sans-serif; font-size: 10px; }
    @media print { body { background: #fff; } .pdf-sheet { margin: 0; } }
  `;

  const lines = (count) => '<div class="writing-lines">' + '<i></i>'.repeat(count) + '</div>';
  const pdfMarkup = `
    <section class="pdf-sheet">
      <h1 class="brand-title">FINDE DEIN DING</h1>
      <h2 class="document-title">Mein persönliches Commitment</h2>
      <div class="intro-box"><strong>Dieser Vertrag ist eine Vereinbarung mit mir selbst.</strong><p>Mit meiner Unterschrift entscheide ich mich bewusst dafür, meinen Weg ernst zu nehmen,<br>ehrlich hinzuschauen und aktiv herauszufinden, was wirklich zu mir passt.</p></div>
      <div class="meta-row"><strong>Name:</strong><span></span></div>
      <div class="meta-row"><strong>Startdatum:</strong><span></span></div>
      <section class="write-section"><h2>Warum ich hier bin</h2><p>Ich starte „Finde dein Ding“, weil …</p>${lines(4)}</section>
      <section class="write-section"><h2>Was ich für mich verändern möchte</h2><p>Am Ende dieses Prozesses möchte ich …</p>${lines(4)}</section>
      <section class="write-section cost"><h2>Was es mich kostet, wenn ich weiter keine Klarheit habe</h2><p>Emotional, Beruflich, Lebensqualität, Schlaf etc.</p>${lines(4)}</section>
      <div class="footer">FINDE DEIN DING&nbsp;&nbsp;•<b>1</b></div>
    </section>
    <section class="pdf-sheet page-two">
      <h2>Mein Commitment an mich selbst</h2>
      <p style="margin:0 0 8px;font-size:10px">Für die Dauer von „Finde dein Ding“ verpflichte ich mich:</p>
      <ul class="commitment-list">
        <li>mir selbst und meinen Antworten gegenüber ehrlich zu sein,</li>
        <li>mir regelmäßig Zeit für meine persönliche Entwicklung zu nehmen,</li>
        <li>die vereinbarten Übungen und Aufgaben gewissenhaft umzusetzen,</li>
        <li>offen und neugierig zu bleiben, auch wenn ich noch nicht sofort eine Antwort finde,</li>
        <li>meine Gedanken, Wünsche und Zweifel auszusprechen, anstatt sie zurückzuhalten,</li>
        <li>Verantwortung für meine Entscheidungen und meine nächsten Schritte zu übernehmen,</li>
        <li>mich nicht mit anderen zu vergleichen, sondern meinen eigenen Weg zu achten,</li>
        <li>Rückschläge, Widerstände und Unsicherheit als Teil des Prozesses anzunehmen,</li>
        <li>mir Unterstützung zu holen, wenn ich allein nicht weiterkomme,</li>
        <li>und die Erkenntnisse aus diesem Prozess durch konkrete Handlungen in mein Leben zu übertragen.</li>
      </ul>
      <h2>Meine Vereinbarung mit mir selbst:</h2>
      <div class="signature-box"><strong>Mit meiner Unterschrift bestätige ich:</strong><p>Ich bin bereit, mein Ding nicht länger nur zu suchen, sondern ihm Schritt für Schritt<br>näherzukommen.</p></div>
      <div class="signature-line">Ort und Datum:<i></i></div>
      <div class="signature-line">Unterschrift:<i></i></div>
      <div class="closing-brand"><strong>FINDE DEIN DING</strong><span>Mein Weg. Meine Entscheidung. Mein Commitment.</span></div>
      <div class="footer">FINDE DEIN DING&nbsp;&nbsp;•<b>2</b></div>
    </section>
  `;

  const openPdfPreview = (pdfBlob) => {
    const url = URL.createObjectURL(pdfBlob);
    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (previewWindow) {
      previewWindow.focus();
      toast('Dein persönliches Commitment wurde geöffnet.');
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mein-persoenliches-commitment.pdf';
      link.click();
      toast('Die Vorschau wurde blockiert; dein PDF wurde heruntergeladen.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<style>${pdfCss}</style>${pdfMarkup}`;
  Object.assign(wrapper.style, { position: 'fixed', left: '-9999px', top: '0', width: '595px' });
  document.body.appendChild(wrapper);

  try {
    if (!window.jspdf?.jsPDF || !window.html2canvas) throw new Error('PDF libraries not available');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const sheets = [...wrapper.querySelectorAll('.pdf-sheet')];
    for (let index = 0; index < sheets.length; index += 1) {
      const canvas = await window.html2canvas(sheets[index], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    }
    openPdfPreview(pdf.output('blob'));
  } catch (error) {
    const printCss = pdfCss + 'body{background:#fff}.pdf-sheet{margin:0 auto}';
    const fallbackHtml = `<!doctype html><html lang="de"><head><meta charset="UTF-8"><title>Mein persönliches Commitment</title><style>${printCss}</style></head><body>${pdfMarkup}</body></html>`;
    const url = URL.createObjectURL(new Blob([fallbackHtml], { type: 'text/html;charset=utf-8' }));
    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (previewWindow) previewWindow.focus();
    else {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mein-persoenliches-commitment.html';
      link.click();
    }
    toast('Dein Commitment wurde als druckbare Vorschau geöffnet.');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally {
    wrapper.remove();
  }
}

function refreshOnboardingGateState() {
  const privacyChecked = !!$('#privacy')?.checked;
  const commitmentChecked = !!$('#commitment')?.checked;
  const signedUploaded = Boolean(local.signedCommitment?.name);
  $('#commitment').disabled = !signedUploaded;
  if (!signedUploaded) $('#commitment').checked = false;
  $('#startProcess').disabled = !privacyChecked || !commitmentChecked || !signedUploaded;
}

function renderCommitmentUploadState(completed = false) {
  const status = $('#signedCommitmentStatus');
  if (!status) return;
  status.textContent = local.signedCommitment
    ? `Hochgeladen: ${local.signedCommitment.name} • ${new Date(local.signedCommitment.uploadedAt).toLocaleString('de-DE')}`
    : completed ? 'Unterschriebenes Commitment wurde beim Start bestätigt.' : 'Noch kein unterschriebenes Commitment hochgeladen.';
}

function progressPercent() {
  if (!program) return 0;
  return Math.round(program.access.completedWeeks.length / 8 * 100);
}

async function loadProgram(week = null) {
  const suffix = week ? `?week=${week}` : '';
  program = await request(`/api/participant-program${suffix}`);
  const initialView = !initialViewResolved ? (program.onboardingComplete ? 'today' : 'onboarding') : null;
  currentWeek = program.selectedWeek || week || program.access.unlockedWeeks[0] || 1;
  currentContent = program.week;
  if (program.onboardingComplete && currentWeek === 1) {
    try { claraMessages = (await request('/api/participant-program?feature=clara-message&week=1')).messages || []; }
    catch { claraMessages = []; }
  }
  if (initialView) {
    initialViewResolved = true;
    showView(initialView);
    return;
  }
  render();
}

function renderClaraChat() {
  const chat = $('#claraChat');
  if (!chat) return;
  chat.classList.toggle('hidden', currentWeek !== 1 || !program?.onboardingComplete);
  $('#claraMessages').innerHTML = claraMessages.length
    ? claraMessages.map((message) => `<article class="clara-message ${message.role}"><span>${message.role === 'assistant' ? 'Clara' : 'Du'}</span><p>${escapeHtml(message.content).replace(/\n/g, '<br>')}</p></article>`).join('')
    : '<p class="clara-chat-empty">Hier ist Raum für alles, was nicht in ein festes Feld passt.</p>';
  const list = $('#claraMessages');
  list.scrollTop = list.scrollHeight;
}

async function openWeek(week) {
  try { await loadProgram(week); showView('today'); }
  catch (error) { toast(error.status === 403 ? 'Diese Woche ist noch gesperrt.' : error.message); }
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
    notice.innerHTML = '<strong>Bitte beim Onboarding starten</strong><span>Dein Weg, deine Erkenntnisse und Dokumente bleiben sichtbar, aber du kannst sie erst nach dem Start des Onboardings bearbeiten.</span>';
    scope.insertBefore(notice, scope.firstChild);
  }

  if (notice) {
    notice.classList.toggle('hidden', !shouldShow);
  }
}

async function updateWeekOne(stepAction) {
  const flow = $('#weekOneFlow');
  const errorBox = $('#weekOneError');
  if (errorBox) errorBox.textContent = '';
  if (flow) {
    flow.classList.add('is-saving');
    flow.querySelectorAll('button, input, textarea').forEach((control) => { control.disabled = true; });
  }
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'week_1_update', stepAction }) });
    await loadProgram(1);
    $('#weekOneFlow')?.classList.remove('is-saving');
    const nextControl = $('#weekOneFlow textarea:not([disabled]), #weekOneFlow input:not([disabled]), #weekOneFlow button:not([disabled])');
    nextControl?.focus({ preventScroll: true });
    $('#questionText')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('✓ Deine Antwort wurde gespeichert.');
  } catch (error) {
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
  const firstName = (program.profile?.name || '').trim().split(/\s+/)[0];
  const prompt = weekOnePrompt(state, firstName);
  let flow = $('#weekOneFlow');
  if (!flow) {
    flow = document.createElement('div');
    flow.id = 'weekOneFlow';
    $('#answerForm').before(flow);
  }
  flow.classList.remove('is-saving');
  $('#answerForm').classList.add('hidden');
  $('#savedAnswer').classList.add('hidden');
  $('#questionLabel').textContent = prompt.type === 'entry' ? 'Willkommen in Woche 1' : 'Deine nächste Frage';
  $('#questionText').textContent = prompt.title;
  const questionParts = [prompt.transition || '', prompt.quote ? `„${prompt.quote}“` : '', prompt.question || '', prompt.help || ''].filter(Boolean);
  $('#questionHelp').innerHTML = questionParts.map((part, index) => index === 0 ? `<strong>${escapeHtml(part)}</strong>` : escapeHtml(part)).join('<br><br>');

  if (prompt.type === 'entry') {
    flow.innerHTML = '<button class="primary" data-week-one-action="begin">Mit Woche 1 beginnen →</button><p id="weekOneError" class="week-one-error"></p>';
  } else if (prompt.type === 'wishes') {
    flow.innerHTML = `<div class="wish-fields">${[0, 1, 2].map((index) => `<label><strong>Wunsch ${index + 1}</strong>${weekOneTextarea(`wish${index + 1}`, 'Was wünschst du dir?')}<small>Mindestens 6 Wörter</small></label>`).join('')}</div><p class="week-one-example">Statt nur „mehr Freiheit“ beschreib bitte etwas genauer, was du dir wünschst.</p><div class="week-one-actions"><button type="button" class="voice" id="wishSpeech">⌁ Spracheingabe</button><button class="primary" data-week-one-action="save-wishes">Meine drei Wünsche speichern →</button></div><p id="weekOneError" class="week-one-error"></p>`;
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
    flow.innerHTML = '<div class="career-choice"><label class="upload-button" for="fileInput">Lebenslauf hochladen</label><button class="secondary" data-week-one-action="career-dialog">Ohne Lebenslauf weitermachen</button></div><p class="week-one-example">Der Lebenslauf ist optional. Dein beruflicher Weg wird in beiden Varianten gemeinsam vervollständigt.</p><p id="weekOneError" class="week-one-error"></p>';
  } else if (prompt.type === 'career_dialog' || prompt.type === 'career_cv') {
    flow.innerHTML = `${weekOneTextarea('careerAnswer', prompt.type === 'career_cv' ? 'Erkannte Stationen korrigieren oder fehlende Station ergänzen …' : 'Deine wichtigsten beruflichen Stationen …')}<label class="career-confirm-check"><input type="checkbox" id="careerConfirmed"><span>Die wesentlichen Stationen sind vollständig. Es fehlt keine wichtige berufliche Station.</span></label><div class="week-one-actions"><button type="button" class="voice" data-target="careerAnswer">⌁ Spracheingabe</button><button class="primary" data-week-one-action="career-save">Weiter →</button></div><p id="weekOneError" class="week-one-error"></p>`;
  } else if (prompt.type === 'career_confirm') {
    flow.innerHTML = '<div class="career-choice"><button class="primary" data-week-one-action="career-confirm">Ja, vollständig →</button><button class="secondary" data-week-one-action="career-add">Eine Station ergänzen</button></div><p id="weekOneError" class="week-one-error"></p>';
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
  flow.querySelector('[data-week-one-action="career-dialog"]')?.addEventListener('click', () => updateWeekOne({ type: 'choose_career_dialog' }));
  flow.querySelector('[data-week-one-action="career-save"]')?.addEventListener('click', () => updateWeekOne({ type: 'save_career_history', answer: $('#careerAnswer').value, confirmed: $('#careerConfirmed').checked }));
  flow.querySelector('[data-week-one-action="career-confirm"]')?.addEventListener('click', () => updateWeekOne({ type: 'confirm_career', complete: true }));
  flow.querySelector('[data-week-one-action="career-add"]')?.addEventListener('click', () => updateWeekOne({ type: 'confirm_career', complete: false }));

  const statuses = stepStatuses(state);
  const statusSymbol = { open: '○', in_progress: '◐', completed: '✓' };
  const statusLabel = { open: 'offen', in_progress: 'in Bearbeitung', completed: 'abgeschlossen' };
  $('#taskList').innerHTML = statuses.map((step) => `<div class="task week-one-task ${step.status}"><span class="step-state">${statusSymbol[step.status]}</span><span><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.subtitle)}</small></span><i>${statusLabel[step.status]}</i></div>`).join('');
  const done = statuses.filter((step) => step.status === 'completed').length;
  $('#taskCount').textContent = `${done} / 4`;
  $('#uploadButton').childNodes[0].textContent = '⇧ Datei auswählen ';
  $('#uploadButton').classList.add('week-one-upload');
  let cvNote = $('#weekOneCvNote');
  if (!cvNote) {
    cvNote = document.createElement('div');
    cvNote.id = 'weekOneCvNote';
    $('#uploadButton').before(cvNote);
  }
  cvNote.innerHTML = '<div><strong>Lebenslauf</strong><span>Optional</span></div><p>Wenn du keinen Lebenslauf hast, erfasst Clara deinen bisherigen Weg gemeinsam mit dir.</p>';
  $('#gateNote').textContent = program.weekOneGate?.complete ? 'Alle Pflichtschritte sind abgeschlossen. Du kannst Woche 1 abschließen.' : `Die nächste Woche öffnet sich nach Abschluss aller Pflichtschritte.${program.weekOneGate?.missingRequirements?.length ? ` Offen: ${program.weekOneGate.missingRequirements.join(', ')}.` : ''}`;
  $('#completeWeek').disabled = !program.weekOneGate?.complete;
  $('#completeWeek').textContent = 'Woche abschließen →';
  renderClaraChat();
}

function render() {
  if (!program) return;
  const pct = progressPercent();
  const started = program.onboardingComplete;
  const content = currentContent;
  const paused = program.access.status === 'paused';
  const activeView = document.querySelector('aside nav button.active')?.dataset.view || 'onboarding';
  const reviewingOnboarding = activeView === 'onboarding';
  const showOnboarding = !started || reviewingOnboarding;
  document.querySelector('aside nav button[data-view="today"] span').textContent = 'Heute';
  $('#sideProgress').style.width = `${pct}%`;
  $('#sidePercent').textContent = `${pct} % abgeschlossen`;
  $('#sidePhase').textContent = !showOnboarding && started && content ? `Woche ${currentWeek} · ${content.title}` : 'Onboarding';
  $('#headerPhase').textContent = !showOnboarding && started && content ? `Woche ${currentWeek} von 8 · ${content.title}` : 'Onboarding';
  const name = program.profile?.name || 'Teilnehmer';
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelector('.side-foot > div > span').textContent = initials;
  document.querySelector('.side-foot strong').textContent = name;
  $('#onboarding').classList.toggle('hidden', !showOnboarding);
  $('#activeWeek').classList.toggle('hidden', showOnboarding || !started || !content);
  renderPausedState();

  if (showOnboarding) {
    renderCommitmentUploadState(started);
    $('#todayLabel').textContent = started ? 'Onboarding abgeschlossen' : paused ? 'Programm pausiert' : 'Dein Start';
    $('#welcomeTitle').innerHTML = 'Willkommen bei <em>Finde dein Ding.</em>';
    $('#welcomeCopy').innerHTML = paused
      ? 'Dein Zugang ist pausiert. Bitte wende dich an Markus.'
      : 'In den nächsten Wochen geht es um eine zentrale Frage: <strong>Was ist wirklich dein Ding – und wie machst du daraus deinen Weg?</strong><br>Clara begleitet dich dabei Schritt für Schritt. Du musst heute noch keine Antworten haben. Du musst nur bereit sein, ehrlich hinzuschauen.';
    $('#clarityValue').textContent = '—';
    $('#startProcess').classList.toggle('hidden', started);
    $('#revokePrivacy').classList.toggle('hidden', !started);
    if (started) {
      $('#privacy').checked = true;
      $('#privacy').disabled = true;
      $('#commitment').checked = true;
      $('#commitment').disabled = true;
    } else {
      $('#privacy').disabled = false;
      refreshOnboardingGateState();
      $('#startProcess').disabled = paused || $('#startProcess').disabled;
    }
  } else if (content) {
    $('#revokePrivacy').classList.add('hidden');
    $('#todayLabel').textContent = `Woche ${currentWeek} · ${content.mode}`;
    $('#welcomeTitle').innerHTML = `${content.title}. <em>Schritt für Schritt.</em>`;
    $('#welcomeCopy').textContent = currentWeek === 1 ? 'Wir schauen, wo du heute stehst und was sich für dich verändern soll.' : `${program.access.completedWeeks.length} von 8 Wochen abgeschlossen · ${modeLabel(program.access.accessMode)}.`;
    $('#clarityValue').textContent = local.clarityEnd || local.clarityStart || '—';
    $('#clarityValue').nextElementSibling.textContent = 'Klarheit / 10';
    $('#claraContext').textContent = `Woche ${currentWeek} · ${content.mode}`;
    if (currentWeek === 1) renderWeekOne();
    else {
      $('#claraChat')?.classList.add('hidden');
      $('#weekOneFlow')?.remove();
      $('#weekOneCvNote')?.remove();
      $('#answerForm').classList.remove('hidden');
      $('#uploadButton').classList.remove('week-one-upload');
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
      $('#uploadButton').childNodes[0].textContent = `⇧ ${content.upload} `;
      $('#completeWeek').disabled = paused || done < content.tasks.length;
      $('#completeWeek').textContent = currentWeek === 8 ? 'Digitalen Prozess abschließen →' : 'Woche abschließen →';
      $('#gateNote').textContent = program.access.accessMode === 'completion_based' ? 'Die nächste Woche öffnet sich nach Abschluss aller Pflichtaufgaben.' : program.access.accessMode === 'time_based' ? 'Weitere Wochen öffnen sich automatisch alle sieben Tage.' : 'Alle Wochen sind freigeschaltet; Pflichtaufgaben dokumentieren deinen Fortschritt.';
    }
  }
  renderJourney(); renderInsights(); renderDocuments();
  renderLockedViewNotice();
  wireSpeechControls();
}

function renderJourney() {
  const summaries = new Map((program?.accessibleWeeks || []).map((week) => [week.week, week]));
  $('#journeyGrid').innerHTML = (program?.access.weekStates || []).map((state) => {
    const summary = summaries.get(state.week);
    const active = state.week === currentWeek;
    const status = state.completed ? '✓ abgeschlossen' : active ? '● geöffnet' : state.accessible ? '○ verfügbar' : 'gesperrt';
    const reason = state.reason === 'admin_unlocked' ? 'Vom Admin freigegeben' : state.reason === 'admin_locked' ? 'Vom Admin gesperrt' : state.reason === 'scheduled_release' ? 'Zeitlich freigeschaltet' : state.accessible ? 'Zugriff freigegeben' : 'Noch nicht freigeschaltet';
    return `<article class="week-card ${state.completed ? 'completed' : active ? 'active' : state.accessible ? 'available' : 'locked'}" ${state.accessible ? `data-open-week="${state.week}" tabindex="0" role="button"` : ''}><span>Woche ${state.week}</span><i>${status}</i><h2>${summary ? summary.title : 'Noch gesperrt'}</h2><p>${summary ? summary.mode : 'Inhalte werden nach der Freischaltung sichtbar.'}</p><b>${reason}</b></article>`;
  }).join('');
  $$('[data-open-week]').forEach((card) => {
    card.addEventListener('click', () => openWeek(Number(card.dataset.openWeek)));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') openWeek(Number(card.dataset.openWeek)); });
  });
}

function renderInsights() {
  const answerText = Object.values(local.answers).join(' ').toLowerCase();
  const motivators = ['Freiheit', 'Neugier', 'Beziehungen', 'Wirkung'].filter((item) => answerText.includes(item.toLowerCase()));
  $('#motivatorTags').innerHTML = motivators.length ? motivators.map((item) => `<span class="tag">${item}</span>`).join('') : '<i>Entwickelt sich in Woche 3</i>';
  const values = program.access.completedWeeks.includes(5) ? ['Eigenverantwortung', 'Ehrlichkeit', 'Entwicklung'] : [];
  $('#valueTags').innerHTML = values.length ? values.map((item) => `<span class="tag">${item}</span>`).join('') : '<i>Öffnet sich in Woche 5</i>';
  $('#clarityChart').innerHTML = `<b>Start ${local.clarityStart || '—'}</b><i></i><b>${local.clarityEnd ? 'Ende' : 'Heute'} ${local.clarityEnd || local.clarityStart || '—'}</b>`;
}

function renderDocuments() {
  const articles = $$('#documentList article');
  if (program.onboardingComplete) { articles[0].classList.remove('locked'); articles[0].querySelector('small').textContent = 'Digital bestätigt'; articles[0].querySelector('i').textContent = 'Erledigt'; }
  [[4, 1, 'Bereit'], [6, 2, 'Bereit'], [8, 3, 'Wird erzeugt']].forEach(([week, index, label]) => { if (program.access.completedWeeks.includes(week)) { articles[index].classList.remove('locked'); articles[index].querySelector('i').textContent = label; } });
}

$('#privacy').addEventListener('change', refreshOnboardingGateState);
$('#commitment').addEventListener('change', refreshOnboardingGateState);
$('#printCommitment').addEventListener('click', openCommitmentPrintView);
$('#signedCommitmentUpload').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  local.signedCommitment = { name: file.name, type: file.type, size: file.size, uploadedAt: new Date().toISOString(), flowVersion: 2 };
  saveLocal();
  renderCommitmentUploadState();
  refreshOnboardingGateState();
  toast('Dein unterschriebenes Commitment wurde hochgeladen.');
});
$('#startProcess').addEventListener('click', async () => {
  const signedUploaded = Boolean(local.signedCommitment?.name);
  const button = $('#startProcess');
  button.disabled = true;
  button.textContent = 'Woche 1 wird vorbereitet …';
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'start', privacy: $('#privacy').checked, commitment: $('#commitment').checked, signedDocument: signedUploaded }) });
    await loadProgram(1);
    showView('today');
    toast('Alles erfolgreich erledigt. Ich leite dich jetzt zu Woche 1 weiter.');
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
    $('#commitment').checked = false;
    await loadProgram();
    showView('onboarding');
    toast('Deine Einwilligung wurde widerrufen.');
  } catch (error) { toast(error.message); }
});
$('#answerForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const answer = $('#answer').value.trim(); if (!answer) return;
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_answer', week: currentWeek, answer }) }); local.answers[currentWeek] = answer; if (currentWeek === 1 && !local.clarityStart) { const score = Number(prompt('Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?')); if (score >= 1 && score <= 10) local.clarityStart = score; } saveLocal(); await loadProgram(currentWeek); toast('Deine Antwort wurde serverseitig gespeichert.'); }
  catch (error) { toast(error.message); }
});
$('#claraChatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#claraChatInput');
  const button = $('#sendClaraMessage');
  const message = input.value.trim();
  if (!message || button.disabled) return;
  const pending = { role: 'participant', content: message, created_at: new Date().toISOString() };
  claraMessages.push(pending);
  input.value = '';
  button.disabled = true;
  button.textContent = 'Clara denkt …';
  renderClaraChat();
  try {
    const result = await request('/api/participant-program?feature=clara-message', { method: 'POST', body: JSON.stringify({ week: 1, message, clientMessageId: crypto.randomUUID() }) });
    claraMessages.push(result.message);
    program.weekOne = result.weekOne;
    program.weekOneGate = result.gate;
    currentContent.tasks = result.steps;
    render();
  } catch (error) {
    claraMessages = claraMessages.filter((item) => item !== pending);
    input.value = message;
    renderClaraChat();
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Senden →';
  }
});

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

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
      await updateWeekOne({ type: 'cv_uploaded', fileName: file.name, fileId: uploaded.document.id, stations: uploaded.document.extractedData?.stations || [] });
      if (uploaded.document.status === 'needs_ocr') toast('Das Dokument ist vermutlich gescannt. Es wurde für die OCR-Verarbeitung vorgemerkt.');
    } catch (error) { toast(error.message); }
    event.target.value = '';
    return;
  }
  if (!currentContent?.tasks[2]) return;
  local.uploads[currentWeek] = { name: file.name, type: file.type, size: file.size, at: new Date().toISOString() }; saveLocal();
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'set_gate', week: currentWeek, gateId: currentContent.tasks[2].id, completed: true }) }); await loadProgram(currentWeek); toast(`${file.name} wurde erfasst und der Pflichtschritt bestätigt.`); }
  catch (error) { toast(error.message); }
});
$('#reopenCurrentWeek').addEventListener('click', async () => {
  if (!program?.onboardingComplete || !currentContent) return;
  const confirmed = window.confirm(`Bist du sicher, dass du Woche ${currentWeek} erneut starten möchtest?\n\nDadurch werden alle deine Inhalte aus dieser Woche unwiderruflich gelöscht.`);
  if (!confirmed) return;
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'reopen_week', week: currentWeek }) });
    delete local.answers[currentWeek];
    delete local.uploads[currentWeek];
    if (currentWeek === 1) {
      delete local.clarityStart;
      claraMessages = [];
    }
    saveLocal();
    await loadProgram(currentWeek);
    toast(`Woche ${currentWeek} wurde zurückgesetzt und neu gestartet.`);
  } catch (error) {
    toast(error.message);
  }
});
$('#completeWeek').addEventListener('click', async () => {
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'complete_week', week: currentWeek }) }); if (currentWeek === 8 && !local.clarityEnd) { const score = Number(prompt('Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?')); if (score >= 1 && score <= 10) { local.clarityEnd = score; saveLocal(); } } await loadProgram(currentWeek < 8 ? currentWeek + 1 : 8); toast(currentWeek === 8 ? 'Digitaler Prozess abgeschlossen.' : 'Woche abgeschlossen.'); }
  catch (error) { toast(error.message); }
});
$('#saveSupport').addEventListener('click', () => { const text = $('#supportText').value.trim(); if (!text) return; local.support.push({ text, week: currentWeek, at: new Date().toISOString() }); $('#supportText').value = ''; saveLocal(); toast('Deine Frage wurde für das Q&A gespeichert.'); });
$('#customerLogout').addEventListener('click', async () => { await fetch('/api/auth?action=session', { method: 'DELETE' }); location.replace('/login'); });

loadProgram().catch((error) => { if (error.status === 401) location.replace('/kunden-login'); else toast(error.message); });
