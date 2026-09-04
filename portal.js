import { journeyStepStatuses, weekOnePrompt } from './lib/week-one.js';
import { currentGuidedStep, guidedClarityStep, guidedStepStatuses, guidedWeekDefinition, needsGuidedClarityCheckin } from './lib/guided-weeks.js';

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
let customerWorkspace = null;
let currentWeek = 1;
let currentContent = null;
let initialViewResolved = false;
let todayMode = 'dashboard';
let journeyMessages = [];
let journeyLoading = false;
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
  const response = await fetch(url, { ...options, headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers });
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = {}; }
  if (!response.ok) { const error = new Error(data.error || 'Die Anfrage konnte nicht verarbeitet werden.'); error.status = response.status; error.data = data; throw error; }
  return data;
}

function modeLabel() { return 'Automatische Freischaltung alle sieben Tage'; }


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

function weekIsFinalized(week = currentWeek) {
  const recordedWeek = Number(program?.access?.recordedCurrentWeek || 0);
  return Number(week) < recordedWeek || (Number(week) === 8 && program?.access?.recordedProcessStatus === 'FINAL_REPORT');
}

function applyWeekReadOnlyState(allStepsCompleted = false) {
  const finalized = weekIsFinalized();
  const locked = finalized || allStepsCompleted;
  $('#activeWeek').classList.toggle('week-read-only', locked);
  $('#uploadButton').hidden = locked;
  const moreActions = $('#reopenCurrentWeek')?.closest('details');
  if (moreActions) moreActions.hidden = locked;
  const composer = $('#claraJourneyForm');
  if (composer) composer.hidden = locked;
  if (finalized) {
    $('#completeWeek').disabled = true;
    $('#completeWeek').textContent = 'Woche abgeschlossen ✓';
    $('#gateNote').textContent = 'Diese Woche ist abgeschlossen. Alle Schritte und gespeicherten Inhalte bleiben für dich anklickbar und schreibgeschützt.';
  }
}

function activeProcessWeek(access = program?.access) {
  const week = Number(access?.processWeek);
  if (Number.isInteger(week) && week >= 1 && week <= 8) return week;
  const completed = new Set((access?.completedWeeks || []).map(Number));
  return Array.from({ length: 8 }, (_, index) => index + 1).find((item) => !completed.has(item)) || 8;
}

async function loadProgram(week = null) {
  const suffix = week ? `?week=${week}` : '';
  program = await request(`/api/participant-program${suffix}`);
  if (!customerWorkspace) {
    try { customerWorkspace = await request('/api/customer-records?action=overview'); }
    catch { customerWorkspace = null; }
  }
  const initialView = !initialViewResolved ? (program.onboardingComplete ? 'today' : 'onboarding') : null;
  currentWeek = program.selectedWeek || week || program.access.unlockedWeeks[0] || 1;
  currentContent = program.week;
  if (program.onboardingComplete && currentWeek >= 1) {
    try { journeyMessages = (await request(`/api/participant-program?feature=clara-message&week=${currentWeek}`)).messages || []; }
    catch { journeyMessages = []; }
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
  journey.classList.toggle('hidden', !program?.onboardingComplete || clarityCheckinPending);
  const guidedStep = currentWeek >= 2 ? currentGuidedStep(program?.weekState) : null;
  const initialPrompt = program?.weekOne?.current_step === 'THREE_WISHES_COLLECTION'
    ? '<article class="clara-message assistant"><span>Clara</span><p>Stell dir vor, du hättest drei Wünsche frei – ganz unabhängig davon, ob sie gerade realistisch sind.<br><br><strong>Welche drei Dinge würdest du dir für dein Leben gerade am meisten wünschen?</strong><br><br>Schreib einfach drauflos. Wir schauen sie uns danach gemeinsam an.</p></article>'
    : guidedStep
      ? `<article class="clara-message assistant"><span>Clara</span><p>${escapeHtml(guidedStep.question)}</p></article>`
      : '<p class="clara-chat-empty">Hier ist Raum für alles, was nicht in ein festes Feld passt.</p>';
  const messageHtml = journeyMessages.length
    ? journeyMessages.map((message) => `<article class="clara-message ${message.role}"><span>${message.role === 'assistant' ? 'Clara' : 'Du'}</span><p>${escapeHtml(message.content).replace(/\n/g, '<br>')}</p>${renderClaraResultCard(message.uiAction)}</article>`).join('')
    : initialPrompt;
  $('#journeyMessages').innerHTML = `${messageHtml}${journeyLoading ? '<article class="clara-message assistant loading" aria-live="polite"><span>Clara</span><p><i></i><i></i><i></i><em>Clara denkt nach …</em></p></article>' : ''}`;
  const list = $('#journeyMessages');
  list.scrollTop = list.scrollHeight;
  const readOnly = weekIsFinalized() || (currentWeek === 1 ? program?.weekOneGate?.complete : program?.weekGate?.complete);
  $('#claraJourneyForm').hidden = Boolean(readOnly || clarityCheckinPending);
  list.querySelectorAll('button').forEach((button) => { button.disabled = Boolean(readOnly); });
  list.querySelectorAll('[data-clara-confirm]').forEach((button) => button.addEventListener('click', () => confirmClaraResult(button.dataset.claraConfirm, button)));
  list.querySelectorAll('[data-clara-revise]').forEach((button) => button.addEventListener('click', () => {
    $('#claraJourneyInput').value = button.dataset.claraRevise;
    $('#claraJourneyInput').focus();
  }));
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
  $('#sendJourneyMessage').disabled = true;
  renderClaraJourney();
  try {
    const result = await request('/api/participant-program?feature=clara-message', { method: 'POST', body: JSON.stringify({ week: 1, action: 'confirm_result', confirmationToken, clientMessageId: crypto.randomUUID() }) });
    journeyMessages.push({ role: 'participant', content: 'Passt so', created_at: new Date().toISOString() }, result.message);
    program.weekOne = result.weekOne;
    program.weekOneGate = result.gate;
    currentContent.tasks = result.steps;
    journeyLoading = false;
    $('#sendJourneyMessage').disabled = false;
    render();
    toast('✓ Deine drei Wünsche wurden bestätigt.');
  } catch (error) {
    journeyLoading = false;
    $('#sendJourneyMessage').disabled = false;
    renderClaraJourney();
    toast(error.message);
  }
}

async function openWeek(week) {
  try { todayMode = 'week'; await loadProgram(week); showView('today'); }
  catch (error) { toast(error.status === 403 ? 'Diese Woche ist noch gesperrt.' : error.message); }
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
  $('#dashboardClarityValue').textContent = latest?.score || '—';
  target.setAttribute('aria-label', measurements.length ? `Klarheitsverlauf: ${measurements.map((item) => `Woche ${item.week}: ${item.score} von 10`).join(', ')}` : 'Noch keine Klarheitswerte vorhanden');

  const left = 66;
  const right = 842;
  const top = 24;
  const bottom = 236;
  const x = (week) => left + ((Number(week) - 1) / 7) * (right - left);
  const y = (score) => bottom - ((Number(score) - 1) / 9) * (bottom - top);
  const points = measurements.map((item) => `${x(item.week)},${y(item.score)}`).join(' ');
  const scoreColor = (score) => Number(score) >= 7 ? '#c89a2e' : Number(score) >= 4 ? '#e98943' : '#d26758';
  const gridLines = [1, 4, 7, 10].map((score) => `<g><line x1="${left}" y1="${y(score)}" x2="${right}" y2="${y(score)}"></line><text x="42" y="${y(score) + 4}">${score}</text></g>`).join('');
  const weekLabels = Array.from({ length: 8 }, (_, index) => `<text class="week-label" x="${x(index + 1)}" y="274">W${index + 1}</text>`).join('');
  const dots = measurements.map((item) => `<g class="clarity-point"><circle cx="${x(item.week)}" cy="${y(item.score)}" r="8" fill="${scoreColor(item.score)}"></circle><circle cx="${x(item.week)}" cy="${y(item.score)}" r="15" fill="none" stroke="${scoreColor(item.score)}" opacity=".2"></circle><text x="${x(item.week)}" y="${y(item.score) - 17}">${item.score}</text></g>`).join('');
  target.innerHTML = `<svg viewBox="0 0 880 292" aria-hidden="true" focusable="false"><defs><linearGradient id="clarityLineGradient" x1="0" x2="1"><stop offset="0" stop-color="#d26758"></stop><stop offset=".5" stop-color="#e98943"></stop><stop offset="1" stop-color="#c89a2e"></stop></linearGradient></defs><rect class="clarity-low-band" x="${left}" y="${y(4)}" width="${right - left}" height="${bottom - y(4)}"></rect><rect class="clarity-growth-band" x="${left}" y="${y(7)}" width="${right - left}" height="${y(4) - y(7)}"></rect><rect class="clarity-target-band" x="${left}" y="${top}" width="${right - left}" height="${y(7) - top}"></rect>${gridLines}${points ? `<polyline class="clarity-progress-line" points="${points}"></polyline>` : ''}${dots}${weekLabels}<text class="target-label" x="${right - 10}" y="${top + 18}">ZIELBEREICH 7–10</text></svg>${measurements.length ? '' : '<p>Noch kein Klarheitswert gespeichert. Deine erste Messung entsteht in Woche 1.</p>'}`;
}

function renderProgramDashboard() {
  if (!program?.access) return;
  const summaries = new Map((program.programWeeks || []).map((week) => [Number(week.week), week]));
  const states = program.access.weekStates || [];
  const activeWeek = activeProcessWeek(program.access);
  const activeSummary = summaries.get(activeWeek) || summaries.get(1);
  const nextState = states.find((state) => !state.accessible && state.unlocksAt);
  const completed = program.access.completedWeeks.length;
  $('#dashboardProgressTitle').textContent = completed === 8 ? 'Alle 8 Wochen abgeschlossen' : `Woche ${activeWeek} von 8`;
  $('#dashboardProgressCopy').textContent = `${completed} von 8 Wochen abgeschlossen · Projektstart ${formatProgramDate(program.access.programStartDate)}.`;
  $('#dashboardStatusBadge').textContent = program.access.status === 'paused' ? 'Programm pausiert' : completed === 8 ? 'Programm abgeschlossen' : 'Programm aktiv';
  $('#dashboardCurrentNumber').textContent = String(activeWeek).padStart(2, '0');
  $('#dashboardCurrentTitle').textContent = activeSummary?.title || 'Deine aktuelle Woche';
  $('#dashboardCurrentCopy').textContent = activeSummary ? `${activeSummary.mode} · Diese Woche ist entsprechend deinem persönlichen Zeitplan freigeschaltet.` : 'Dein nächster Bereich wird vorbereitet.';
  $('#dashboardStartDate').textContent = formatProgramDate(program.access.programStartDate);
  $('#dashboardEndDate').textContent = formatProgramDate(program.access.programEndDate);
  $('#dashboardNextDate').textContent = nextState ? `Woche ${nextState.week} · ${formatProgramDate(nextState.unlocksAt)}` : 'Alle Wochen freigeschaltet';
  const currentButton = $('#openCurrentWeek');
  currentButton.dataset.dashboardWeek = String(activeWeek);
  currentButton.disabled = program.access.status === 'paused' || !states.some((state) => state.week === activeWeek && state.accessible);
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
  $('#completeWeek').textContent = 'Woche abschließen →';
  renderClaraJourney();
  applyWeekReadOnlyState(done === statuses.length);
}

async function updateGuidedWeek(stepAction) {
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'guided_week_update', week: currentWeek, stepAction }) });
    await loadProgram(currentWeek);
    toast('✓ Dein Schritt wurde gespeichert.');
  } catch (error) { toast(error.message); }
}

function renderGuidedWeek() {
  const state = program.weekState;
  const definition = guidedWeekDefinition(currentWeek);
  if (!state || !definition) return;
  const active = currentGuidedStep(state);
  const clarityPending = needsGuidedClarityCheckin(state);
  const displayedStep = clarityPending ? guidedClarityStep(state) : active;
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
    let selectedChange = null;
    let selectedScore = null;
    const updateSaveState = () => { $('#saveWeeklyClarity').disabled = selectedChange === null || selectedScore === null; };
    flow.querySelectorAll('[data-clarity-change]').forEach((button) => button.addEventListener('click', () => {
      selectedChange = button.dataset.clarityChange === 'true';
      flow.querySelectorAll('[data-clarity-change]').forEach((item) => item.classList.toggle('selected', item === button));
      updateSaveState();
    }));
    flow.querySelectorAll('[data-weekly-clarity-score]').forEach((button) => button.addEventListener('click', () => {
      selectedScore = Number(button.dataset.weeklyClarityScore);
      flow.querySelectorAll('[data-weekly-clarity-score]').forEach((item) => item.classList.toggle('selected', item === button));
      updateSaveState();
    }));
    $('#saveWeeklyClarity').addEventListener('click', () => updateGuidedWeek({ type: 'save_clarity_checkin', stepId: 'weekly_clarity', score: selectedScore, changed: selectedChange, note: $('#weeklyClarityNote').value }));
  } else if (!active) {
    flow.innerHTML = '<div class="week-one-review"><span>✓</span><p>Alle Schritte dieser Woche sind abgeschlossen.</p></div>';
  } else if (active.kind === 'upload') {
    flow.innerHTML = `<div class="journey-upload"><div class="journey-upload-copy"><span>⇧</span><div><strong>${escapeHtml(active.title)}</strong><small>${escapeHtml(active.question)}</small></div></div><label class="journey-upload-action" for="fileInput">↑ Datei auswählen</label><small class="journey-upload-meta">PDF, DOCX, JPG oder PNG · maximal 10 MB</small></div>`;
  } else if (active.kind === 'scale') {
    flow.innerHTML = `<div class="clarity-scale" role="group" aria-label="Klarheitswert">${Array.from({ length: active.max - active.min + 1 }, (_, index) => `<button type="button" data-guided-score="${active.min + index}">${active.min + index}</button>`).join('')}</div>`;
    flow.querySelectorAll('[data-guided-score]').forEach((button) => button.addEventListener('click', () => updateGuidedWeek({ type: 'save_answer', stepId: active.id, score: Number(button.dataset.guidedScore), answer: button.dataset.guidedScore })));
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
  $('#completeWeek').textContent = currentWeek === 8 ? 'Digitalen Prozess abschließen →' : 'Woche abschließen →';
  $('#claraJourney').classList.toggle('hidden', clarityPending || ['upload', 'scale', 'external'].includes(active?.kind));
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
  const showOnboarding = !started || reviewingOnboarding;
  const showDashboard = started && !showOnboarding && activeView === 'today' && todayMode === 'dashboard';
  const dashboardWeek = activeProcessWeek(program.access);
  const dashboardSummary = (program.programWeeks || []).find((item) => Number(item.week) === Number(dashboardWeek));
  const currentClarity = currentClarityMeasurement();
  document.querySelector('aside nav button[data-view="today"] span').textContent = 'Mein Bereich';
  $('#sideProgress').style.width = `${pct}%`;
  $('#sidePercent').textContent = `${pct} % abgeschlossen`;
  $('#sidePhase').textContent = !showOnboarding && started ? `Woche ${dashboardWeek} · ${dashboardSummary?.title || 'Dein Prozess'}` : 'Onboarding';
  $('#sideClarityValue').textContent = `${currentClarity?.score || '—'} / 10`;
  $('#headerClarity').textContent = `Klarheit ${currentClarity?.score || '—'} / 10`;
  $('#headerPhase').textContent = !showOnboarding && started ? `Woche ${showDashboard ? dashboardWeek : currentWeek} von 8 · ${(showDashboard ? dashboardSummary?.title : content?.title) || 'Dein Prozess'}` : 'Onboarding';
  const name = program.profile?.name || 'Teilnehmer';
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  $('#portalProfileAvatar').innerHTML = customerWorkspace?.profile?.photoUrl ? `<img src="${escapeHtml(customerWorkspace.profile.photoUrl)}" alt="Dein Profilbild">` : escapeHtml(initials);
  document.querySelector('.portal-profile strong').textContent = name;
  $('#onboarding').classList.toggle('hidden', !showOnboarding);
  $('#programDashboard').classList.toggle('hidden', !showDashboard);
  $('#activeWeek').classList.toggle('hidden', showOnboarding || showDashboard || !started || !content);
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
      $('#completeWeek').textContent = currentWeek === 8 ? 'Digitalen Prozess abschließen →' : 'Woche abschließen →';
      $('#gateNote').textContent = 'Weitere Wochen öffnen sich automatisch alle sieben Tage ab deinem Projektstart.';
    }
  }
  renderJourney(); renderInsights(); renderDocuments();
  renderLockedViewNotice();
  wireSpeechControls();
}

function renderJourney() {
  const summaries = new Map((program?.programWeeks || []).map((week) => [week.week, week]));
  $('#journeyGrid').innerHTML = (program?.access.weekStates || []).map((state) => {
    const summary = summaries.get(state.week);
    const active = state.week === currentWeek;
    const status = state.completed ? '✓ abgeschlossen' : active ? '● geöffnet' : state.accessible ? '○ verfügbar' : 'gesperrt';
    const reason = state.reason === 'admin_unlocked' ? 'Vom Admin freigegeben' : state.reason === 'admin_locked' ? 'Vom Admin gesperrt' : state.reason === 'scheduled_release' ? `Freigeschaltet seit ${formatProgramDate(state.unlocksAt)}` : state.reason === 'scheduled_wait' ? `Öffnet am ${formatProgramDate(state.unlocksAt)}` : state.accessible ? 'Zugriff freigegeben' : 'Noch nicht freigeschaltet';
    return `<article class="week-card ${state.completed ? 'completed' : active ? 'active' : state.accessible ? 'available' : 'locked'}" data-preview-week="${state.week}" tabindex="0" role="button"><span>Woche ${state.week}</span><i>${status}</i><h2>${escapeHtml(summary?.title || `Woche ${state.week}`)}</h2><p>${escapeHtml(summary?.description || summary?.mode || 'Dein nächster Schritt im Acht-Wochen-Prozess.')}</p><b>${reason} · Details ansehen</b></article>`;
  }).join('');
  $$('#journeyGrid [data-preview-week]').forEach((card) => {
    card.addEventListener('click', () => openWeekPreview(Number(card.dataset.previewWeek)));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWeekPreview(Number(card.dataset.previewWeek)); } });
  });
}

function renderInsights() {
  const answerText = Object.values(local.answers).join(' ').toLowerCase();
  const motivators = ['Freiheit', 'Neugier', 'Beziehungen', 'Wirkung'].filter((item) => answerText.includes(item.toLowerCase()));
  $('#motivatorTags').innerHTML = motivators.length ? motivators.map((item) => `<span class="tag">${item}</span>`).join('') : '<i>Entwickelt sich in Woche 3</i>';
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
  const official = (customerWorkspace?.contracts || []).flatMap((contract) => [{ title: contract.title || 'Vertragsdokument', ready: Boolean(contract.document_confirmed_at), label: 'Vertrag' }, { title: `Videovertrag · ${contract.title || 'Vertragsabschluss'}`, ready: Boolean(contract.video_contract_confirmed_at), label: 'Videovertrag' }]);
  const uploaded = (customerWorkspace?.documents || []).map((document) => ({ title: document.display_title || document.original_file_name, ready: true, label: document.source === 'customer' ? 'Von dir hochgeladen' : 'Für dich bereitgestellt', document }));
  $('#documentList').insertAdjacentHTML('beforeend', [...official, ...uploaded].map((item) => `<article class="customer-record-doc ${item.ready ? '' : 'locked'}"><span>▤</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.label)}</small></div>${item.document ? `<a href="/api/customer-records?action=document-download&documentId=${encodeURIComponent(item.document.id)}" target="_blank" rel="noopener">Öffnen ↗</a>` : `<i>${item.ready ? 'Bestätigt' : 'Offen'}</i>`}</article>`).join(''));
}

function renderPortalAppointments() {
  const target = $('#portalAppointmentList');
  if (!target) return;
  const appointments = customerWorkspace?.appointments || [], now = Date.now();
  const upcoming = appointments.filter((item) => item.status === 'scheduled' && new Date(item.starts_at).getTime() >= now);
  const past = appointments.filter((item) => !upcoming.includes(item)).slice().reverse();
  const group = (title, items) => `<section><h2>${title}</h2>${items.length ? items.map((item) => `<article><time><b>${new Date(item.starts_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}</b><span>${new Date(item.starts_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</span></time><div><strong>${escapeHtml(item.title || 'Kundentermin')}</strong><p>${item.status === 'cancelled' ? 'Abgesagt' : item.status === 'completed' ? 'Abgeschlossen' : 'Geplant'} · Google Kalender</p></div>${item.meet_url ? `<a href="${escapeHtml(item.meet_url)}" target="_blank" rel="noopener">Google Meet öffnen →</a>` : '<span class="portal-appointment-note">Kein Meet-Link</span>'}</article>`).join('') : '<div class="portal-appointment-empty">Keine Termine vorhanden.</div>'}</section>`;
  target.innerHTML = group('Deine nächsten Termine', upcoming) + group('Vergangene Termine', past);
}

$('#openCurrentWeek').addEventListener('click', (event) => openWeek(Number(event.currentTarget.dataset.dashboardWeek || program?.access?.currentWeek || 1)));
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
    todayMode = 'dashboard';
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
    $('#commitment').checked = false;
    await loadProgram();
    showView('onboarding');
    toast('Deine Einwilligung wurde widerrufen.');
  } catch (error) { toast(error.message); }
});
$('#answerForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const answer = $('#answer').value.trim(); if (!answer) return;
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_answer', week: currentWeek, answer }) }); local.answers[currentWeek] = answer; saveLocal(); await loadProgram(currentWeek); toast('Deine Antwort wurde serverseitig gespeichert.'); }
  catch (error) { toast(error.message); }
});
$('#claraJourneyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#claraJourneyInput');
  const button = $('#sendJourneyMessage');
  const message = input.value.trim();
  if (!message || button.disabled) return;
  const pending = { role: 'participant', content: message, created_at: new Date().toISOString() };
  journeyMessages.push(pending);
  input.value = '';
  journeyLoading = true;
  button.disabled = true;
  button.textContent = 'Clara denkt …';
  renderClaraJourney();
  try {
    const result = await request('/api/participant-program?feature=clara-message', { method: 'POST', body: JSON.stringify({ week: currentWeek, message, clientMessageId: crypto.randomUUID() }) });
    journeyMessages.push(result.message);
    if (currentWeek === 1) {
      program.weekOne = result.weekOne;
      program.weekOneGate = result.gate;
    } else {
      program.weekState = result.weekState;
      program.weekGate = result.gate;
    }
    currentContent.tasks = result.steps;
    render();
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

$('#claraJourneyInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!$('#sendJourneyMessage').disabled) $('#claraJourneyForm').requestSubmit();
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
      journeyMessages = [];
    }
    saveLocal();
    await loadProgram(currentWeek);
    toast(`Woche ${currentWeek} wurde zurückgesetzt und neu gestartet.`);
  } catch (error) {
    toast(error.message);
  }
});
$('#completeWeek').addEventListener('click', async () => {
  const completedWeek = currentWeek;
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'complete_week', week: completedWeek }) }); todayMode = 'dashboard'; await loadProgram(); showView('today'); toast(completedWeek === 8 ? 'Digitaler Prozess abgeschlossen.' : `Woche ${completedWeek} abgeschlossen. Deine Übersicht wurde aktualisiert.`); }
  catch (error) { toast(error.message); }
});
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
$('#customerLogout').addEventListener('click', async () => { await fetch('/api/auth?action=session', { method: 'DELETE' }); location.replace('/login'); });

loadProgram().catch((error) => { if (error.status === 401) location.replace('/kunden-login'); else toast(error.message); });
