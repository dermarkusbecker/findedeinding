const params = new URLSearchParams(location.search);
const form = document.querySelector('#leadForm');
const status = document.querySelector('#formStatus');
const menu = document.querySelector('.menu');
const navigation = document.querySelector('.site-header nav');
const navWrap = document.querySelector('.nav-wrap');
const leadDialog = document.querySelector('#leadDialog');
let leadDialogTrigger = null;

const openLeadDialog = (trigger = null) => {
  if (!leadDialog || leadDialog.open) return;
  leadDialogTrigger = trigger;
  document.body.classList.add('lead-dialog-open');
  leadDialog.showModal();
  requestAnimationFrame(() => form.elements.name?.focus());
};

const closeLeadDialog = () => {
  if (leadDialog?.open) leadDialog.close();
};

const replayPanel = (element) => {
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.classList.remove('is-changing');
  requestAnimationFrame(() => element.classList.add('is-changing'));
};

window.addEventListener('scroll', () => navWrap.classList.toggle('scrolled', window.scrollY > 24), { passive: true });

menu.addEventListener('click', () => {
  const isOpen = navigation.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(isOpen));
  menu.setAttribute('aria-label', isOpen ? 'Menü schließen' : 'Menü öffnen');
});

document.querySelectorAll('.site-header nav a').forEach((link) => link.addEventListener('click', () => {
  navigation.classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Menü öffnen');
}));

document.querySelectorAll('[data-open-lead-dialog]').forEach((trigger) => trigger.addEventListener('click', (event) => {
  event.preventDefault();
  openLeadDialog(trigger);
}));
document.querySelector('[data-close-lead-dialog]')?.addEventListener('click', closeLeadDialog);
leadDialog?.addEventListener('click', (event) => { if (event.target === leadDialog) closeLeadDialog(); });
leadDialog?.addEventListener('close', () => {
  document.body.classList.remove('lead-dialog-open');
  if (location.hash === '#start') history.replaceState(null, '', `${location.pathname}${location.search}`);
  leadDialogTrigger?.focus();
  leadDialogTrigger = null;
});
if (location.hash === '#start') openLeadDialog();

const choiceContent = {
  direction: ['Deine Richtung', 'Du musst die Antwort noch nicht kennen.', 'Wir beginnen bei dem, was bereits da ist: deiner Geschichte, deinen Wünschen und den Momenten, die dir Energie geben.'],
  options: ['Deine Kriterien', 'Nicht jede gute Idee ist auch deine.', 'Gemeinsam machen wir sichtbar, welche Möglichkeiten wirklich zu dir passen – und nach welchen Kriterien du klar entscheiden kannst.'],
  courage: ['Dein nächster Schritt', 'Aus einem Ziel wird ein gangbarer Weg.', 'Wir übersetzen deine Richtung in kleine, belastbare Schritte. So entsteht Bewegung, ohne dass du heute schon alles riskieren musst.'],
  change: ['Dein neues Bild', 'Dein Gefühl ist ein guter Anfang.', 'Wir schauen ehrlich auf das, was nicht mehr passt, und entwickeln daraus ein Bild davon, wie dein Leben stattdessen aussehen soll.']
};
document.querySelectorAll('.choice').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.choice').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  const [card, title, text] = choiceContent[button.dataset.choice];
  document.querySelector('#resultCardTitle').textContent = card;
  document.querySelector('#resultTitle').textContent = title;
  document.querySelector('#resultText').textContent = text;
  replayPanel(document.querySelector('.choice-result'));
}));

const processContent = [
  ['WOCHE 1–2 · VERSTEHEN', 'Deine Geschichte wird zur stärksten Datenquelle.', 'Clara führt dich durch deine Wünsche, Stationen und Erfahrungen. Du antwortest in deinen eigenen Worten.', 'Was soll nach diesen acht Wochen anders sein als heute?', 'Ein klares Fundament'],
  ['WOCHE 3–4 · ERKENNEN', 'Du erkennst, was dich wirklich bewegt.', 'Energiequellen, natürliche Stärken und wiederkehrende Muster werden miteinander verbunden.', 'Bei welcher Tätigkeit vergisst du manchmal die Zeit?', 'Deine persönlichen Muster'],
  ['WOCHE 5–6 · VERDICHTEN', 'Aus Erkenntnissen werden echte Kriterien.', 'Du schärfst dein gewünschtes Leben, deine Werte und das, was für dich nicht mehr verhandelbar ist.', 'Woran würdest du merken, dass eine Richtung wirklich zu dir passt?', 'Deine Ding-Map'],
  ['WOCHE 7–8 · ENTSCHEIDEN', 'Aus Möglichkeiten wird deine Richtung.', 'Du vergleichst tragfähige Optionen, triffst deine Entscheidung und übersetzt sie in einen konkreten Plan.', 'Welcher kleine Schritt würde deine Entscheidung heute real machen?', 'Dein 90-Tage-Plan']
];
document.querySelectorAll('.process-tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.process-tab').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); });
  button.classList.add('active'); button.setAttribute('aria-selected', 'true');
  const [label, title, text, question, outcome] = processContent[Number(button.dataset.step)];
  document.querySelector('#processLabel').textContent = label;
  document.querySelector('#processTitle').textContent = title;
  document.querySelector('#processText').textContent = text;
  document.querySelector('#processQuestion').textContent = question;
  document.querySelector('#processOutcome').textContent = outcome;
  replayPanel(document.querySelector('.process-preview'));
}));

const claraContent = {
  memory: ['Was würde sich in deinem Leben verändern, wenn dieser Wunsch erfüllt wäre?', 'Ich hätte wieder das Gefühl, meine Zeit für etwas zu nutzen, das mir wirklich wichtig ist.', 'MUSTER FESTGEHALTEN', 'Sinn · Selbstbestimmung · Wirkung'],
  patterns: ['Wenn du an deine besten Tage denkst: Was war dort anders als sonst?', 'Ich konnte etwas gestalten, hatte Freiheit und war trotzdem mit Menschen im Austausch.', 'ZUSAMMENHANG ERKANNT', 'Gestalten · Autonomie · Verbindung'],
  human: ['An dieser Stelle kann ein persönlicher Blick helfen. Soll Markus dazukommen?', 'Ja. Ich möchte meine beiden Möglichkeiten mit ihm gemeinsam sortieren.', 'PERSÖNLICHE BEGLEITUNG', 'Gespräch mit Markus vorbereitet']
};
const activateClara = (item) => {
  document.querySelectorAll('.clara-feature').forEach((feature) => feature.classList.remove('active'));
  item.classList.add('active');
  const [question, answer, label, insight] = claraContent[item.dataset.clara];
  document.querySelector('#claraQuestion').textContent = question;
  document.querySelector('#claraAnswer').textContent = answer;
  document.querySelector('#claraInsightLabel').textContent = label;
  document.querySelector('#claraInsight').textContent = insight;
  replayPanel(document.querySelector('.clara-demo'));
};
document.querySelectorAll('.clara-feature').forEach((item) => {
  item.addEventListener('click', () => activateClara(item));
  item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateClara(item); } });
});

const controlContent = {
  answers: ['DEINE ORIGINALANTWORT', 'Erst erzählen.\nNoch nichts Persönliches verlieren.', 'Was du Clara sagst, bleibt als deine eigene Antwort erkennbar und kann später von dir korrigiert werden.', 'GESPEICHERT · HEUTE', '„Ich möchte etwas aufbauen, das Menschen wirklich hilft.“'],
  insights: ['CLARAS SPIEGELUNG', 'Du siehst, was verstanden wurde – und was noch offen ist.', 'Claras Erkenntnisse stehen getrennt neben deinen Aussagen. So bleibt jederzeit nachvollziehbar, woher ein Muster kommt.', 'ERKANNT · AUS 4 ANTWORTEN', 'Sinn und Selbstbestimmung tauchen wiederholt gemeinsam auf.'],
  choice: ['DEINE BESTÄTIGUNG', 'Persönlich wird es erst, wenn du es möchtest.', 'Kein Schritt und keine wichtige Erkenntnis wird ohne deine bewusste Entscheidung als abgeschlossen behandelt.', 'BEREIT ZUR BESTÄTIGUNG', 'Diese Richtung fühlt sich für mich stimmig genug an, um sie zu testen.']
};
document.querySelectorAll('.control-step').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.control-step').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  const [label, title, text, cardLabel, cardText] = controlContent[button.dataset.control];
  document.querySelector('#controlLabel').textContent = label;
  document.querySelector('#controlTitle').innerHTML = title.replace('\n', '<br>');
  document.querySelector('#controlText').textContent = text;
  document.querySelector('#controlCardLabel').textContent = cardLabel;
  document.querySelector('#controlCardText').textContent = cardText;
  replayPanel(document.querySelector('.control-preview'));
}));

const revealItems = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -35px' });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('visible'));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true; status.textContent = 'Wird gesendet …'; status.className = 'form-status';
  const payload = Object.fromEntries(new FormData(form));
  payload.consent = Boolean(form.elements.consent.checked);
  payload.source = params.get('utm_source') || document.referrer || 'website';
  ['utm_source', 'utm_medium', 'utm_campaign'].forEach((key) => payload[key] = params.get(key));
  try {
    const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    form.reset(); status.textContent = 'Danke! Markus meldet sich persönlich bei dir.'; status.className = 'form-status success';
    if (window.fbq) window.fbq('track', 'Lead');
  } catch (error) { status.textContent = error.message || 'Das hat nicht geklappt. Bitte versuche es erneut.'; status.className = 'form-status error'; }
  finally { button.disabled = false; }
});
