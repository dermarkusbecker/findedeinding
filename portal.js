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
let program = null;
let currentWeek = 1;
let currentContent = null;
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
  const data = await response.json().catch(() => ({}));
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
    <p>Ich nehme den achtwöchigen Prozess ernsthaft in Angriff.</p>
    <p>Ich bin bereit, meine Antworten ehrlich zu formulieren, meine Widerstände sichtbar zu machen und mich nicht vorschnell aus dem Prozess zu verabschieden.</p>
    <p>Ich möchte meine Entscheidung nicht nur denken, sondern sie konkret erleben, prüfen und mit Verantwortung weiterentwickeln.</p>
    <p>Ich bestätige hiermit bewusst mein persönliches Commitment für den Start dieses Prozesses.</p>
    <div class="commitment-signature"><span>Ort, Datum</span><span>__________________</span></div>
    <div class="commitment-signature"><span>Name</span><span>${escapeHtml(name)}</span></div>
    <div class="commitment-signature"><span>Unterschrift</span><span>__________________</span></div>
  `;
}

async function openCommitmentPrintView() {
  const name = (program?.profile?.name || 'Teilnehmer').trim() || 'Teilnehmer';
  const pdfCss = `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f5f2ee;
      color: #1a1b1a;
      font-family: Arial, sans-serif;
    }
    .pdf-sheet {
      width: 595px;
      min-height: 842px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #d7d7d3;
      border-radius: 16px;
      padding: 42px 46px;
      box-shadow: 0 8px 20px rgba(26, 27, 26, 0.06);
    }
    h1 {
      font-size: 29px;
      margin: 0 0 18px;
      line-height: 1.2;
      color: #1a1b1a;
    }
    .meta {
      margin: 24px 0 18px;
      font-size: 15px;
      font-weight: 700;
    }
    p {
      font-size: 14px;
      line-height: 1.7;
      margin: 0 0 14px;
      color: #1a1b1a;
    }
    .sign-row {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid #d7d7d3;
      align-items: baseline;
    }
    .sign-row span {
      font-size: 12px;
      color: #4d514e;
      display: inline-block;
    }
    .sign-row strong {
      font-size: 14px;
      font-weight: 700;
      display: inline-block;
    }
  `;

  const pdfMarkup = `
    <div class="pdf-sheet">
      <h1>Mein Start-Commitment</h1>
      <div class="meta"><strong>${escapeHtml(name)}</strong></div>
      <p>Ich nehme den achtwöchigen Prozess ernsthaft in Angriff.</p>
      <p>Ich bin bereit, meine Antworten ehrlich zu formulieren, meine Widerstände sichtbar zu machen und mich nicht vorschnell aus dem Prozess zu verabschieden.</p>
      <p>Ich möchte meine Entscheidung nicht nur denken, sondern sie konkret erleben, prüfen und mit Verantwortung weiterentwickeln.</p>
      <p>Ich bestätige hiermit bewusst mein persönliches Commitment für den Start dieses Prozesses.</p>
      <div class="sign-row"><span>Ort, Datum</span><strong>____________________________</strong></div>
      <div class="sign-row"><span>Name</span><strong>${escapeHtml(name)}</strong></div>
      <div class="sign-row"><span>Unterschrift</span><strong>____________________________</strong></div>
    </div>
  `;

  const openPdfPreview = (pdfBlob) => {
    const url = URL.createObjectURL(pdfBlob);
    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (previewWindow) {
      previewWindow.focus();
      toast('PDF-Vorschau geöffnet. Du kannst sie im Browser herunterladen.');
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mein-start-commitment.pdf';
      link.click();
      toast('PDF-Vorschau wurde blockiert; die Datei wurde direkt heruntergeladen.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<style>${pdfCss}</style>${pdfMarkup}`;
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '-9999px';
  wrapper.style.width = '595px';
  document.body.appendChild(wrapper);

  try {
    if (!window.jspdf || !window.jspdf.jsPDF || !window.html2canvas) {
      throw new Error('PDF libraries not available');
    }

    const { jsPDF } = window.jspdf;
    const canvas = await window.html2canvas(wrapper, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const pdfWidth = pageWidth - margin * 2;
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    let y = margin;
    let heightLeft = pdfHeight;

    pdf.addImage(imgData, 'PNG', margin, y, pdfWidth, pdfHeight, undefined, 'FAST');
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      y = margin - (pageHeight - margin * 2) - heightLeft + 20;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, y, pdfWidth, pdfHeight, undefined, 'FAST');
      heightLeft -= pageHeight - margin * 2;
    }

    openPdfPreview(pdf.output('blob'));
  } catch (error) {
    const fallbackHtml = `<!doctype html><html lang="de"><head><meta charset="UTF-8"><title>Mein Start-Commitment</title><style>${pdfCss}</style></head><body>${pdfMarkup}</body></html>`;
    const blob = new Blob([fallbackHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (previewWindow) {
      previewWindow.focus();
      toast('Vorschau geöffnet. Im Browser kannst du sie als PDF speichern.');
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mein-start-commitment.html';
      link.click();
      toast('Vorschau wurde blockiert; HTML-Datei wurde heruntergeladen.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } finally {
    wrapper.remove();
  }
}

function renderOnboardingDocuments() {
  const participantName = program?.profile?.name || 'Teilnehmer';
  const doc = $('#commitmentDocument');
  if (doc) doc.innerHTML = buildStartCommitmentText(participantName);
  const signedStatus = $('#signedCommitmentStatus');
  if (signedStatus) {
    signedStatus.textContent = local.signedCommitment ? `Hochgeladen: ${local.signedCommitment.name} • ${new Date(local.signedCommitment.uploadedAt).toLocaleString('de-DE')}` : 'Noch kein unterschriebenes Commitment hochgeladen.';
  }
  const signedFileInput = $('#signedCommitmentUpload');
  if (signedFileInput) signedFileInput.value = '';
}

function refreshOnboardingGateState() {
  const privacyChecked = !!$('#privacy')?.checked;
  const commitmentChecked = !!$('#commitment')?.checked;
  const signedUploaded = Boolean(local.signedCommitment && local.signedCommitment.name);
  $('#startProcess').disabled = !privacyChecked || !commitmentChecked || !signedUploaded;
}

function progressPercent() {
  if (!program) return 0;
  return Math.round(program.access.completedWeeks.length / 8 * 100);
}

async function loadProgram(week = null) {
  const suffix = week ? `?week=${week}` : '';
  program = await request(`/api/participant-program${suffix}`);
  currentWeek = program.selectedWeek || week || program.access.unlockedWeeks[0] || 1;
  currentContent = program.week;
  render();
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

function render() {
  if (!program) return;
  const pct = progressPercent();
  const started = program.onboardingComplete;
  const content = currentContent;
  const paused = program.access.status === 'paused';
  $('#sideProgress').style.width = `${pct}%`;
  $('#sidePercent').textContent = `${pct} % abgeschlossen`;
  $('#sidePhase').textContent = started && content ? `Woche ${currentWeek} · ${content.title}` : 'Onboarding';
  $('#headerPhase').textContent = started && content ? `Woche ${currentWeek} von 8 · ${content.title}` : 'Dein Start';
  const name = program.profile?.name || 'Teilnehmer';
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelector('.side-foot > div > span').textContent = initials;
  document.querySelector('.side-foot strong').textContent = name;
  $('#onboarding').classList.toggle('hidden', started);
  $('#activeWeek').classList.toggle('hidden', !started || !content);
  renderPausedState();

  if (!started) {
    renderOnboardingDocuments();
    $('#todayLabel').textContent = paused ? 'Programm pausiert' : 'Dein Start';
    $('#welcomeTitle').innerHTML = 'Willkommen bei <em>Finde dein Ding.</em>';
    $('#welcomeCopy').textContent = paused ? 'Dein Zugang ist pausiert. Bitte wende dich an Markus.' : 'Bevor Clara mit dir startet, braucht es zwei klare Grundlagen: deine Einwilligung und dein persönliches Commitment.';
    $('#clarityValue').textContent = '—';
    refreshOnboardingGateState();
    $('#startProcess').disabled = paused || $('#startProcess').disabled;
    if (document.querySelector('aside nav button.active')?.dataset.view === 'onboarding') {
      showView('onboarding');
    }
  } else if (content) {
    $('#todayLabel').textContent = `Woche ${currentWeek} · ${content.mode}`;
    $('#welcomeTitle').innerHTML = `${content.title}. <em>Schritt für Schritt.</em>`;
    $('#welcomeCopy').textContent = `${program.access.completedWeeks.length} von 8 Wochen abgeschlossen · ${modeLabel(program.access.accessMode)}.`;
    $('#clarityValue').textContent = local.clarityEnd || local.clarityStart || '—';
    $('#clarityValue').nextElementSibling.textContent = 'Klarheit / 10';
    $('#claraContext').textContent = `Woche ${currentWeek} · ${content.mode}`;
    $('#questionText').textContent = content.question;
    $('#questionHelp').textContent = content.help;
    const answer = local.answers[currentWeek];
    $('#answer').value = '';
    $('#savedAnswer').classList.toggle('hidden', !answer);
    $('#savedAnswer').textContent = answer ? `Zuletzt gespeichert: ${answer}` : '';
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
$('#signedCommitmentUpload').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  local.signedCommitment = { name: file.name, type: file.type, size: file.size, uploadedAt: new Date().toISOString() };
  saveLocal();
  renderOnboardingDocuments();
  refreshOnboardingGateState();
  toast('Unterschriebenes Commitment wurde gespeichert.');
});
$('#startProcess').addEventListener('click', async () => {
  const signedUploaded = Boolean(local.signedCommitment && local.signedCommitment.name);
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'start', privacy: $('#privacy').checked, commitment: $('#commitment').checked && signedUploaded, signedDocument: signedUploaded }) }); await loadProgram(1); toast('Dein achtwöchiger Prozess ist gestartet.'); }
  catch (error) { toast(error.message); }
});
$('#answerForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const answer = $('#answer').value.trim(); if (!answer) return;
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'save_answer', week: currentWeek, answer }) }); local.answers[currentWeek] = answer; if (currentWeek === 1 && !local.clarityStart) { const score = Number(prompt('Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?')); if (score >= 1 && score <= 10) local.clarityStart = score; } saveLocal(); await loadProgram(currentWeek); toast('Deine Antwort wurde serverseitig gespeichert.'); }
  catch (error) { toast(error.message); }
});
$('#fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file || !currentContent?.tasks[2]) return;
  local.uploads[currentWeek] = { name: file.name, type: file.type, size: file.size, at: new Date().toISOString() }; saveLocal();
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'set_gate', week: currentWeek, gateId: currentContent.tasks[2].id, completed: true }) }); await loadProgram(currentWeek); toast(`${file.name} wurde erfasst und das Gate bestätigt.`); }
  catch (error) { toast(error.message); }
});
$('#reopenCurrentWeek').addEventListener('click', async () => {
  if (!program?.onboardingComplete || !currentContent) return;
  const confirmed = window.confirm(`Bist du dir sicher, dass du die Woche ${currentWeek} erneut starten möchtest?\n\nDer bisherige Verlauf bleibt erhalten. Du kannst die Inhalte dieser Woche noch einmal bewusst durchlaufen.`);
  if (!confirmed) return;
  try {
    await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'reopen_week', week: currentWeek }) });
    await loadProgram(currentWeek);
    toast(`Woche ${currentWeek} wurde erneut geöffnet.`);
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
