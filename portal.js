const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const local = { ...JSON.parse(localStorage.getItem('fdd_customer_notes') || '{}'), answers: JSON.parse(localStorage.getItem('fdd_customer_notes') || '{}').answers || {}, uploads: JSON.parse(localStorage.getItem('fdd_customer_notes') || '{}').uploads || {}, support: JSON.parse(localStorage.getItem('fdd_customer_notes') || '{}').support || [] };
let program = null;
let currentWeek = 1;
let currentContent = null;

function saveLocal() { localStorage.setItem('fdd_customer_notes', JSON.stringify(local)); }
function toast(message) { const el = $('#portalToast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function showView(name) { $$('.screen').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name)); $$('aside nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === name)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
$$('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewLink)));

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'Die Anfrage konnte nicht verarbeitet werden.'); error.status = response.status; error.data = data; throw error; }
  return data;
}

function modeLabel(mode) {
  return mode === 'time_based' ? 'Zeitbasierte Freischaltung' : mode === 'full_access' ? 'Alles freigegeben' : 'Abschlussbasierte Freischaltung';
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
    $('#todayLabel').textContent = paused ? 'Programm pausiert' : 'Dein Start';
    $('#welcomeTitle').innerHTML = 'Willkommen bei <em>Finde dein Ding.</em>';
    $('#welcomeCopy').textContent = paused ? 'Dein Zugang ist pausiert. Bitte wende dich an Markus.' : 'Bevor Clara mit dir startet, braucht es zwei klare Grundlagen: deine Einwilligung und dein persönliches Commitment.';
    $('#clarityValue').textContent = '—';
    $('#startProcess').disabled = paused || !($('#privacy').checked && $('#commitment').checked);
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

$('#privacy').addEventListener('change', () => { $('#startProcess').disabled = !($('#privacy').checked && $('#commitment').checked); });
$('#commitment').addEventListener('change', () => { $('#startProcess').disabled = !($('#privacy').checked && $('#commitment').checked); });
$('#startProcess').addEventListener('click', async () => {
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'start', privacy: $('#privacy').checked, commitment: $('#commitment').checked }) }); await loadProgram(1); toast('Dein achtwöchiger Prozess ist gestartet.'); }
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
$('#completeWeek').addEventListener('click', async () => {
  try { await request('/api/participant-program', { method: 'PATCH', body: JSON.stringify({ action: 'complete_week', week: currentWeek }) }); if (currentWeek === 8 && !local.clarityEnd) { const score = Number(prompt('Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?')); if (score >= 1 && score <= 10) { local.clarityEnd = score; saveLocal(); } } await loadProgram(currentWeek < 8 ? currentWeek + 1 : 8); toast(currentWeek === 8 ? 'Digitaler Prozess abgeschlossen.' : 'Woche abgeschlossen.'); }
  catch (error) { toast(error.message); }
});
$('#saveSupport').addEventListener('click', () => { const text = $('#supportText').value.trim(); if (!text) return; local.support.push({ text, week: currentWeek, at: new Date().toISOString() }); $('#supportText').value = ''; saveLocal(); toast('Deine Frage wurde für das Q&A gespeichert.'); });
$('#customerLogout').addEventListener('click', async () => { await fetch('/api/auth?action=session', { method: 'DELETE' }); location.replace('/login'); });

loadProgram().catch((error) => { if (error.status === 401) location.replace('/kunden-login'); else toast(error.message); });
