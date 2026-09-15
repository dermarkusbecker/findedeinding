import { INTAKE_QUESTIONS } from './lib/intake.js';
const COOKIE_CONSENT_KEY = 'fdd-cookie-consent-v1';
const COOKIE_CONSENT_VERSION = 2;
const cookieConsent = document.querySelector('#cookieConsent');
const cookieConsentSettings = document.querySelector('#cookieConsentSettings');
const cookieAnalytics = document.querySelector('#cookieAnalytics');
const cookieMarketing = document.querySelector('#cookieMarketing');
let activeCookieConsent = readCookieConsent();
let cookieConsentHideTimer = null;
let cookieConsentTrigger = null;

function normalizeCookieConsent(value) {
  if (!value || value.version !== COOKIE_CONSENT_VERSION || typeof value.analytics !== 'boolean' || typeof value.marketing !== 'boolean') return null;
  return { version: COOKIE_CONSENT_VERSION, necessary: true, analytics: value.analytics, marketing: value.marketing, decidedAt: value.decidedAt || null };
}

function readCookieConsent() {
  try { return normalizeCookieConsent(JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY) || 'null')); }
  catch { return null; }
}

function applyCookieConsent(consent) {
  const preference = normalizeCookieConsent(consent) || { version: COOKIE_CONSENT_VERSION, necessary: true, analytics: false, marketing: false, decidedAt: null };
  document.documentElement.dataset.analyticsConsent = preference.analytics ? 'granted' : 'denied';
  document.documentElement.dataset.marketingConsent = preference.marketing ? 'granted' : 'denied';
  try { if (typeof window.fbq === 'function') window.fbq('consent', preference.marketing ? 'grant' : 'revoke'); } catch (error) { console.warn('Cookie-Auswahl gespeichert; Tracking-Schnittstelle nicht erreichbar.'); }
  window.dispatchEvent(new CustomEvent('fdd:cookie-consent', { detail: { ...preference } }));
}

function cookieConsentAllows(category) {
  return category === 'necessary' || Boolean(activeCookieConsent?.[category]);
}

function setCookieSettingsVisibility(visible) {
  if (!cookieConsentSettings) return;
  cookieConsentSettings.hidden = !visible;
  document.querySelector('[data-cookie-settings-toggle]')?.setAttribute('aria-expanded', String(visible));
  cookieConsent?.classList.toggle('has-settings', visible);
}

function showCookieConsent({ settings = false, trigger = null } = {}) {
  if (!cookieConsent) return;
  clearTimeout(cookieConsentHideTimer);
  cookieConsentTrigger = trigger;
  if (cookieAnalytics) cookieAnalytics.checked = Boolean(activeCookieConsent?.analytics);
  if (cookieMarketing) cookieMarketing.checked = Boolean(activeCookieConsent?.marketing);
  setCookieSettingsVisibility(settings);
  cookieConsent.hidden = false;
  requestAnimationFrame(() => {
    cookieConsent.classList.add('is-visible');
    if (trigger) cookieConsent.querySelector('[data-cookie-choice="necessary"]')?.focus();
  });
}

function hideCookieConsent() {
  if (!cookieConsent) return;
  cookieConsent.classList.remove('is-visible');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  cookieConsentHideTimer = window.setTimeout(() => {
    cookieConsent.hidden = true;
    cookieConsentTrigger?.focus();
    cookieConsentTrigger = null;
  }, reducedMotion ? 0 : 260);
}

function saveCookieConsent({ analytics = false, marketing = false } = {}) {
  activeCookieConsent = { version: COOKIE_CONSENT_VERSION, necessary: true, analytics: Boolean(analytics), marketing: Boolean(marketing), decidedAt: new Date().toISOString() };
  try { localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(activeCookieConsent)); } catch {}
  if (cookieAnalytics) cookieAnalytics.checked = activeCookieConsent.analytics;
  if (cookieMarketing) cookieMarketing.checked = activeCookieConsent.marketing;
  applyCookieConsent(activeCookieConsent);
  hideCookieConsent();
}

function revealCookieConsentIfNeeded() {
  const url = new URL(window.location.href);
  const settingsRequested = url.searchParams.get('cookie-settings') === '1';
  if (!activeCookieConsent || settingsRequested) showCookieConsent({ settings: settingsRequested });
  if (settingsRequested) {
    url.searchParams.delete('cookie-settings');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

applyCookieConsent(activeCookieConsent);

const siteLoader = document.querySelector('#siteLoader');
let siteLoaderFinished = false;
const finishSiteLoader = () => {
  if (siteLoaderFinished) return;
  siteLoaderFinished = true;
  if (!siteLoader) {
    document.body.classList.remove('site-loading');
    revealCookieConsentIfNeeded();
    return;
  }
  clearTimeout(window.__fddLoaderSlowTimer);
  clearTimeout(window.__fddLoaderFailSafe);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startedAt = Number(window.__fddLoaderStartedAt) || performance.now();
  const elapsed = performance.now() - startedAt;
  const finishDelay = reducedMotion ? 0 : Math.max(0, 300 - elapsed);
  window.setTimeout(() => {
    siteLoader.classList.add('is-finishing');
    const message = document.querySelector('#siteLoaderStatus');
    if (message) message.textContent = 'Bereit. Dein Weg kann beginnen.';
    window.setTimeout(() => {
      siteLoader.classList.add('is-complete');
      document.body.classList.remove('site-loading');
      revealCookieConsentIfNeeded();
      window.setTimeout(() => siteLoader.remove(), reducedMotion ? 120 : 600);
    }, reducedMotion ? 0 : 420);
  }, finishDelay);
};

if (document.readyState === 'complete') queueMicrotask(finishSiteLoader);
else window.addEventListener('load', finishSiteLoader, { once: true });

const params = new URLSearchParams(location.search);
const form = document.querySelector('#leadForm');
const status = document.querySelector('#formStatus');
const menu = document.querySelector('.menu');
const navigation = document.querySelector('.site-header nav');
const navWrap = document.querySelector('.nav-wrap');
const leadDialog = document.querySelector('#leadDialog');
const claraDetailsDialog = document.querySelector('#claraDetailsDialog');
const clarityDetailsDialog = document.querySelector('#clarityDetailsDialog');
let leadDialogTrigger = null;
let claraDetailsTrigger = null;
let restoreClaraDetailsFocus = true;
let clarityDetailsTrigger = null;
let restoreClarityDetailsFocus = true;
let publicLeadStep = 1;
let publicSlotRangeStart = '';
const publicLeadDraftKey = 'fdd-public-lead-draft-v1';
let publicLeadDraftTimer = null;

document.querySelectorAll('[data-cookie-choice]').forEach((button) => button.addEventListener('click', () => {
  const choice = button.dataset.cookieChoice;
  if (choice === 'all') saveCookieConsent({ analytics: true, marketing: true });
  else if (choice === 'selection') saveCookieConsent({ analytics: cookieAnalytics?.checked, marketing: cookieMarketing?.checked });
  else saveCookieConsent();
}));
document.querySelector('[data-cookie-settings-toggle]')?.addEventListener('click', (event) => {
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  setCookieSettingsVisibility(!expanded);
  if (!expanded) requestAnimationFrame(() => document.querySelector('[data-cookie-choice="selection"]')?.focus());
});
document.querySelectorAll('[data-open-cookie-settings]').forEach((button) => button.addEventListener('click', () => showCookieConsent({ settings: true, trigger: button })));

const openClaraDetails = (trigger = null) => {
  if (!claraDetailsDialog || claraDetailsDialog.open) return;
  claraDetailsTrigger = trigger;
  restoreClaraDetailsFocus = true;
  document.body.classList.add('lead-dialog-open');
  claraDetailsDialog.showModal();
  requestAnimationFrame(() => claraDetailsDialog.querySelector('[data-close-clara-details]')?.focus());
};

const closeClaraDetails = ({ restoreFocus = true } = {}) => {
  if (!claraDetailsDialog?.open) return;
  restoreClaraDetailsFocus = restoreFocus;
  claraDetailsDialog.close();
};

const openClarityDetails = (trigger = null) => {
  if (!clarityDetailsDialog || clarityDetailsDialog.open) return;
  clarityDetailsTrigger = trigger;
  restoreClarityDetailsFocus = true;
  document.body.classList.add('lead-dialog-open');
  clarityDetailsDialog.showModal();
  requestAnimationFrame(() => clarityDetailsDialog.querySelector('[data-close-clarity-details]')?.focus());
};

const closeClarityDetails = ({ restoreFocus = true } = {}) => {
  if (!clarityDetailsDialog?.open) return;
  restoreClarityDetailsFocus = restoreFocus;
  clarityDetailsDialog.close();
};

const openLeadDialog = (trigger = null) => {
  if (!leadDialog || leadDialog.open) return;
  closeClaraDetails({ restoreFocus: false });
  closeClarityDetails({ restoreFocus: false });
  leadDialogTrigger = trigger;
  resetPublicLeadJourney();
  document.body.classList.add('lead-dialog-open');
  leadDialog.showModal();
  requestAnimationFrame(() => document.querySelector('#intakeQuestion h3')?.focus());
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
document.querySelectorAll('[data-open-clara-details]').forEach((trigger) => trigger.addEventListener('click', () => openClaraDetails(trigger)));
document.querySelectorAll('[data-close-clara-details]').forEach((trigger) => trigger.addEventListener('click', () => closeClaraDetails()));
claraDetailsDialog?.addEventListener('click', (event) => { if (event.target === claraDetailsDialog) closeClaraDetails(); });
claraDetailsDialog?.addEventListener('close', () => {
  if (!leadDialog?.open) document.body.classList.remove('lead-dialog-open');
  if (restoreClaraDetailsFocus) claraDetailsTrigger?.focus();
  claraDetailsTrigger = null;
  restoreClaraDetailsFocus = true;
});
document.querySelectorAll('[data-open-clarity-details]').forEach((trigger) => trigger.addEventListener('click', () => openClarityDetails(trigger)));
document.querySelectorAll('[data-close-clarity-details]').forEach((trigger) => trigger.addEventListener('click', () => closeClarityDetails()));
clarityDetailsDialog?.addEventListener('click', (event) => { if (event.target === clarityDetailsDialog) closeClarityDetails(); });
clarityDetailsDialog?.addEventListener('close', () => {
  if (!leadDialog?.open && !claraDetailsDialog?.open) document.body.classList.remove('lead-dialog-open');
  if (restoreClarityDetailsFocus) clarityDetailsTrigger?.focus();
  clarityDetailsTrigger = null;
  restoreClarityDetailsFocus = true;
});
document.querySelectorAll('[data-close-lead-dialog]').forEach((button) => button.addEventListener('click', closeLeadDialog));
leadDialog?.addEventListener('click', (event) => { if (event.target === leadDialog) closeLeadDialog(); });
leadDialog?.addEventListener('close', () => {
  document.body.classList.remove('lead-dialog-open');
  if (location.hash === '#start') history.replaceState(null, '', `${location.pathname}${location.search}`);
  leadDialogTrigger?.focus();
  leadDialogTrigger = null;
});
if (location.hash === '#start') queueMicrotask(() => openLeadDialog());

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

const clarityStoryContent = {
  1: ['Deine Ausgangslage wird ehrlich sichtbar – ohne dass du heute schon eine Lösung kennen musst.', 'Dein Startwert'],
  2: ['Erste Zusammenhänge geben Orientierung: Du erkennst, welche Fähigkeiten und Bedingungen wirklich zu dir passen.', '+2 Punkte seit deinem Start'],
  3: ['Ein niedrigerer Wert ist kein Rückschritt. Neue Erkenntnisse können zunächst mehr Fragen öffnen – und genau das macht den Prozess ehrlich.', '+1 Punkt seit deinem Start'],
  4: ['Wiederkehrende Muster werden greifbar. Du kannst klarer benennen, was dir Energie gibt und was dir fehlt.', '+3 Punkte seit deinem Start'],
  5: ['Deine Werte werden zu konkreten Kriterien. Möglichkeiten lassen sich dadurch bewusster vergleichen.', '+3 Punkte seit deinem Start'],
  6: ['Mehr Klarheit heißt: Du kannst deine Optionen jetzt an deinen eigenen Kriterien prüfen.', '+4 Punkte seit deinem Start'],
  7: ['Deine Favoriten sind nicht mehr nur Ideen. Du kannst begründen, welche Richtung wirklich zu dir passt.', '+5 Punkte seit deinem Start'],
  8: ['10 von 10 – deine Richtung ist glasklar! Jetzt wird daraus dein konkreter 90-Tage-Plan.', '+7 Punkte seit deinem Start · Ziel im Beispiel erreicht'],
};
const clarityClaraPrompts = [
  'Was soll nach diesen acht Wochen für dich klarer sein?',
  'Wann hast du dich zuletzt am richtigen Platz gefühlt – und warum?',
  'Welche neue Frage verunsichert dich gerade? Lass uns sie einzeln betrachten.',
  'Welche Tätigkeiten geben dir Energie? Was wiederholt sich in deinen Antworten?',
  'Was muss eine Richtung erfüllen, damit sie zu deinen Werten passt?',
  'Welche deiner Optionen erfüllt diese Kriterien – und was möchtest du noch prüfen?',
  'Woran würdest du im Alltag merken, dass diese Richtung zu dir passt?',
  'Welcher erste Schritt macht deine Richtung im Alltag konkret?',
];
const activateClarityWeek = (button) => {
  const week = Number(button.dataset.clarityWeek);
  const score = Number(button.dataset.score);
  const content = clarityStoryContent[week];
  if (!content) return;
  document.querySelectorAll('[data-clarity-week]').forEach((item) => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
  document.querySelectorAll('[data-clarity-point]').forEach((point) => point.setAttribute('aria-pressed', String(Number(point.dataset.clarityPoint) === week)));
  document.querySelectorAll('.clarity-story-points circle').forEach((point, index) => {
    point.classList.toggle('current', index === week - 1);
    point.setAttribute('r', index === week - 1 ? '9' : '7');
  });
  document.querySelector('#clarityStoryScore').textContent = String(score);
  document.querySelector('#clarityStoryWeek').textContent = `WOCHE ${week} · DEIN MESSPUNKT`;
  document.querySelector('#clarityStoryInsight').textContent = content[0];
  document.querySelector('#clarityStoryDelta').textContent = content[1];
  document.querySelector('#clarityClaraPrompt').textContent = clarityClaraPrompts[week - 1];
  replayPanel(document.querySelector('.clarity-week-insight'));
};
document.querySelectorAll('[data-clarity-week]').forEach((button) => button.addEventListener('click', () => activateClarityWeek(button)));
document.querySelectorAll('[data-clarity-week]').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
document.querySelectorAll('[data-clarity-point]').forEach((point) => {
  const selectPoint = () => activateClarityWeek(document.querySelector(`[data-clarity-week="${point.dataset.clarityPoint}"]`));
  point.addEventListener('click', selectPoint);
  point.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPoint();
    }
  });
});

const claraContent = {
  memory: ['Was würde sich in deinem Leben verändern, wenn dieser Wunsch erfüllt wäre?', 'Ich hätte wieder das Gefühl, meine Zeit für etwas zu nutzen, das mir wirklich wichtig ist.', 'MUSTER FESTGEHALTEN', 'Sinn · Selbstbestimmung · Wirkung'],
  patterns: ['Wenn du an deine besten Tage denkst: Was war dort anders als sonst?', 'Ich konnte etwas gestalten, hatte Freiheit und war trotzdem mit Menschen im Austausch.', 'ZUSAMMENHANG ERKANNT', 'Gestalten · Autonomie · Verbindung'],
  decision: ['Welche kleine Handlung würde diese Richtung in den nächsten 24 Stunden realer machen?', 'Ich vereinbare ein Gespräch und prüfe meine Idee an der Realität.', 'NÄCHSTER SCHRITT', 'Eigene Entscheidung · konkret umgesetzt']
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

const trustCards = document.querySelectorAll('.trust-card');
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  trustCards.forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const bounds = card.getBoundingClientRect();
      card.style.setProperty('--trust-x', `${Math.round(((event.clientX - bounds.left) / bounds.width) * 100)}%`);
      card.style.setProperty('--trust-y', `${Math.round(((event.clientY - bounds.top) / bounds.height) * 100)}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--trust-x', '50%');
      card.style.setProperty('--trust-y', '50%');
    });
  });
}

const landingDateKey = (date = new Date()) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
};
const addLandingDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const escapeLanding = (value = '') => {
  const span = document.createElement('span');
  span.textContent = String(value);
  return span.innerHTML;
};
let intakeIndex = 0, intakeAnswers = {}, intakeToken = null;
function renderIntakeQuestion() {
 const q=INTAKE_QUESTIONS[intakeIndex], selected=intakeAnswers[q.id];
 document.querySelector('#intakeQuestion').innerHTML=`<p class="intake-counter">Frage ${intakeIndex+1} von 6${q.optional?' · Optional':''}</p><div class="intake-meter" role="progressbar" aria-label="Fragenfortschritt" aria-valuemin="0" aria-valuemax="6" aria-valuenow="${intakeIndex+1}"><span style="width:${(intakeIndex+1)/6*100}%"></span></div><h3 tabindex="-1">${escapeLanding(q.question)}</h3><div class="intake-options" role="group" aria-label="${escapeLanding(q.question)}">${q.options.map((option,i)=>`<button type="button" data-intake-answer="${i}" aria-pressed="${selected===i}"><span>${selected===i?'✓':String(i+1).padStart(2,'0')}</span>${escapeLanding(option)}</button>`).join('')}</div>`;
 document.querySelector('#intakeBack').hidden=intakeIndex===0;
 const next=document.querySelector('#intakeNext'); next.disabled=!q.optional&&!Number.isInteger(selected);next.textContent=q.optional&&!Number.isInteger(selected)?'Überspringen →':intakeIndex===5?'Weiter zum Gespräch →':'Weiter →';
 document.querySelectorAll('[data-intake-answer]').forEach(button=>button.addEventListener('click',()=>{intakeAnswers[q.id]=Number(button.dataset.intakeAnswer);renderIntakeQuestion();document.querySelector(`[data-intake-answer="${intakeAnswers[q.id]}"]`).focus();}));
}
document.querySelector('#intakeNext').addEventListener('click',()=>{if(intakeIndex<5){intakeIndex++;renderIntakeQuestion();document.querySelector('#intakeQuestion h3').focus();}else setPublicLeadStep(2);});
document.querySelector('#intakeBack').addEventListener('click',()=>{intakeIndex=Math.max(0,intakeIndex-1);renderIntakeQuestion();document.querySelector('#intakeQuestion h3').focus();});
function setPublicLeadStep(step, focus = true) {
  publicLeadStep = Math.max(1, Math.min(3, Number(step) || 1));
  leadDialog.classList.toggle('is-booking',publicLeadStep===3);
  form.querySelectorAll('[data-public-lead-step]').forEach((section) => { section.hidden = Number(section.dataset.publicLeadStep) !== publicLeadStep; });
  form.querySelectorAll('[data-public-progress]').forEach((item) => {
    const number = Number(item.dataset.publicProgress);
    item.classList.toggle('active', number === publicLeadStep);
    item.classList.toggle('complete', number < publicLeadStep);
  });
  status.textContent = '';
  status.className = 'form-status';
  if (focus) requestAnimationFrame(() => form.querySelector(`[data-public-lead-step="${publicLeadStep}"] input:not([type="hidden"]), [data-public-lead-step="${publicLeadStep}"] textarea, [data-public-lead-step="${publicLeadStep}"] button`)?.focus());
}
function resetPublicLeadJourney() {
  if (!form) return;
  form.reset();
  intakeIndex=0; intakeAnswers={}; intakeToken=null; renderIntakeQuestion();
  try {
    const draft = JSON.parse(localStorage.getItem(publicLeadDraftKey) || '{}');
    for (const name of ['name', 'email', 'phone', 'challenge']) if (typeof draft[name] === 'string' && form.elements[name]) form.elements[name].value = draft[name];
    if (form.elements.consent) form.elements.consent.checked = draft.consent === true;
  } catch {}
  publicSlotRangeStart = landingDateKey();
  document.querySelector('#publicBookingSuccess').hidden = true;
  document.querySelector('#publicLeadProgress').hidden = false;
  document.querySelector('#publicSelectedSlot').textContent = 'Noch keinen Termin ausgewählt';
  document.querySelector('#publicSelectedSlot').classList.remove('chosen');
  document.querySelector('#publicBookingNotice').textContent = '';
  document.querySelector('#publicBookingNotice').className = 'public-booking-notice';
  document.querySelector('#publicAvailableSlots').innerHTML = '<p>Wähle zuerst deine Kontaktdaten und dein Anliegen.</p>';
  setPublicLeadStep(1, false);
}
function savePublicLeadDraft() {
  clearTimeout(publicLeadDraftTimer);
  publicLeadDraftTimer = setTimeout(() => {
    try {
      localStorage.setItem(publicLeadDraftKey, JSON.stringify({
        name: form.elements.name.value,
        email: form.elements.email.value,
        phone: form.elements.phone.value,
        challenge: form.elements.challenge.value,
        consent: form.elements.consent.checked,
      }));
    } catch {}
  }, 300);
}
function validatePublicLeadStep(step) {
  const section = form.querySelector(`[data-public-lead-step="${step}"]`);
  for (const field of section.querySelectorAll('input, textarea, select')) {
    if (!field.checkValidity()) { field.reportValidity(); field.focus(); return false; }
  }
  return true;
}
let publicCalendarMonth='', publicCalendarDay='', publicCalendarData=null, publicCalendarRequest=0;
const monthKey=(date)=>date.slice(0,7)+'-01';
function moveMonth(key,offset){const date=new Date(key+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,10);}
function clearPublicSlot(){form.elements.appointmentStart.value='';document.querySelector('#publicSelectedSlot').textContent='Wähle einen Tag und eine Uhrzeit.';document.querySelector('#publicSelectedSlot').classList.remove('chosen');form.querySelector('[type="submit"]').disabled=true;}
function renderPublicCalendar(){
 const container=document.querySelector('#publicAvailableSlots'),groups={};
 for(const slot of publicCalendarData.slots||[])(groups[slot.date]||=[]).push(slot);
 if(!groups[publicCalendarDay])publicCalendarDay=Object.keys(groups).sort()[0]||'';
 const first=new Date(publicCalendarMonth+'T12:00:00Z'),offset=(first.getUTCDay()+6)%7,days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 container.innerHTML=`<div class="booking-calendar"><p class="booking-stage-label">1 · Tag auswählen</p><div class="booking-calendar-grid">${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>`<span class="booking-weekday">${d}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}${Array.from({length:days},(_,i)=>{const key=publicCalendarMonth.slice(0,8)+String(i+1).padStart(2,'0'),available=Boolean(groups[key]?.length);return `<button type="button" data-calendar-day="${key}" ${available?'':'disabled'} aria-pressed="${key===publicCalendarDay}" aria-label="${new Date(key+'T12:00:00Z').toLocaleDateString('de-DE',{day:'numeric',month:'long',timeZone:'Europe/Berlin'})}${available?' · Termine verfügbar':' · Keine Termine'}">${i+1}${available?'<i aria-hidden="true"></i>':''}</button>`;}).join('')}</div><p class="booking-calendar-legend">● Termine verfügbar <span>Alle Zeiten: Europe/Berlin</span></p></div><section class="booking-times"><p class="booking-stage-label">2 · Uhrzeit auswählen</p><h4>${publicCalendarDay?new Date(publicCalendarDay+'T12:00:00Z').toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Berlin'}):'Keine freien Termine in diesem Monat'}</h4><p class="booking-duration">${Number(publicCalendarData.durationMinutes)||45} Minuten · Kostenloses Klarheitsgespräch</p><div class="booking-time-grid">${(groups[publicCalendarDay]||[]).map(slot=>`<button type="button" data-public-slot="${escapeLanding(slot.start)}" aria-pressed="${form.elements.appointmentStart.value===slot.start}">${escapeLanding(slot.time)}</button>`).join('')}</div>${publicCalendarDay?'':'<p>Über den Pfeil oben kannst du den nächsten Monat prüfen.</p>'}</section>`;
 container.querySelectorAll('[data-calendar-day]').forEach(button=>button.onclick=()=>{publicCalendarDay=button.dataset.calendarDay;clearPublicSlot();renderPublicCalendar();container.querySelector(`[data-calendar-day="${publicCalendarDay}"]`).focus();});
 container.querySelectorAll('[data-public-slot]').forEach(button=>button.onclick=()=>{form.elements.appointmentStart.value=button.dataset.publicSlot;container.querySelectorAll('[data-public-slot]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));const selected=document.querySelector('#publicSelectedSlot');selected.innerHTML=`<span>Dein ausgewählter Termin</span><strong>${new Date(button.dataset.publicSlot).toLocaleString('de-DE',{weekday:'long',day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'})} Uhr</strong><small>${Number(publicCalendarData.durationMinutes)||45} Minuten · Europe/Berlin</small>`;selected.classList.add('chosen');form.querySelector('[type="submit"]').disabled=false;});
}
async function loadPublicSlots({ advance = false, previous = false } = {}) {
 const requestId=++publicCalendarRequest,container=document.querySelector('#publicAvailableSlots'),rangeLabel=document.querySelector('#publicSlotRange'),more=document.querySelector('#publicNextSlotRange'),back=document.querySelector('#publicPreviousSlotRange');
 publicCalendarMonth=advance?moveMonth(publicCalendarMonth,1):previous?moveMonth(publicCalendarMonth,-1):monthKey(publicSlotRangeStart||landingDateKey());
 const rangeEnd=addLandingDays(moveMonth(publicCalendarMonth,1),-1);
 rangeLabel.textContent=new Date(publicCalendarMonth+'T12:00:00Z').toLocaleDateString('de-DE',{month:'long',year:'numeric',timeZone:'Europe/Berlin'});
 clearPublicSlot();container.setAttribute('aria-busy','true');container.innerHTML='<p class="booking-loading">Freie Termine werden geprüft …</p>';more.disabled=true;back.disabled=true;
 try {
 const response=await fetch(`/api/leads?action=public-available-slots&from=${encodeURIComponent(publicCalendarMonth)}&to=${encodeURIComponent(rangeEnd)}`),data=await response.json();if(requestId!==publicCalendarRequest)return;if(!response.ok)throw Error(data.error||'Bitte versuche es erneut.');publicCalendarData=data;
 const connected=data.calendarConnected===true,notice=document.querySelector('#publicBookingNotice');notice.textContent=connected?'Freie Zeiten sind mit dem Kalender abgeglichen.':'Wir reservieren deine Auswahl. Die persönliche Bestätigung mit Gesprächslink folgt per E-Mail.';notice.className=`public-booking-notice ${connected?'connected':'reservation'}`;
 document.querySelector('#publicBookingMail').textContent='✓ Persönliches Gespräch';document.querySelector('#publicBookingMeet').textContent=connected?'✓ Kalendertermin inklusive':'✓ Bestätigung per E-Mail';
 renderPublicCalendar();more.hidden=false;more.disabled=moveMonth(publicCalendarMonth,1)>addLandingDays(landingDateKey(),Number(data.bookingHorizonDays||60));back.disabled=publicCalendarMonth<=monthKey(landingDateKey());
 }catch(error){if(requestId!==publicCalendarRequest)return;container.innerHTML=`<div class="public-slot-empty error"><strong>Termine konnten nicht geladen werden.</strong><p>${escapeLanding(error.message)}</p><button type="button" data-retry-calendar>Erneut versuchen</button></div>`;container.querySelector('[data-retry-calendar]').onclick=()=>{publicSlotRangeStart=publicCalendarMonth;loadPublicSlots();};more.disabled=false;back.disabled=publicCalendarMonth<=monthKey(landingDateKey());}finally{if(requestId===publicCalendarRequest)container.setAttribute('aria-busy','false');}
}
form.querySelectorAll('[data-public-lead-next]').forEach((button) => button.addEventListener('click', async () => {
  if (!validatePublicLeadStep(publicLeadStep)) return;
  button.disabled=true;
  try {
    const payload=Object.fromEntries(new FormData(form));payload.consent=form.elements.consent.checked;payload.intakeAnswers=intakeAnswers;payload.intakeToken=intakeToken;payload.source=params.get('utm_source')||'website';
    const response=await fetch('/api/leads?action=public-intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Deine Anfrage konnte nicht gespeichert werden.');
    intakeToken=data.intakeToken;
    setPublicLeadStep(publicLeadStep + 1);
  } catch(error){status.textContent=error.message;status.className='form-status error';return;} finally{button.disabled=false;}
  if (publicLeadStep === 3) await loadPublicSlots();
}));
form.querySelectorAll('[data-public-lead-back]').forEach((button) => button.addEventListener('click', () => setPublicLeadStep(publicLeadStep - 1)));
document.querySelector('#publicPreviousSlotRange')?.addEventListener('click', () => loadPublicSlots({ previous: true }));
document.querySelector('#publicNextSlotRange')?.addEventListener('click', () => loadPublicSlots({ advance: true }));
form.addEventListener('input', savePublicLeadDraft);
form.addEventListener('change', savePublicLeadDraft);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (publicLeadStep !== 3 || !validatePublicLeadStep(3)) return;
  if(!form.elements.appointmentStart.value){status.textContent='Bitte wähle zuerst eine Uhrzeit.';return;}
  const button = form.querySelector('[type="submit"]');
  button.disabled = true; status.textContent = 'Termin wird verbindlich geprüft und eingetragen …'; status.className = 'form-status';
  const payload = Object.fromEntries(new FormData(form));
  payload.intakeAnswers = intakeAnswers;
  payload.intakeToken = intakeToken;
  payload.consent = Boolean(form.elements.consent.checked);
  payload.source = params.get('utm_source') || document.referrer || 'website';
  ['utm_source', 'utm_medium', 'utm_campaign'].forEach((key) => payload[key] = params.get(key));
  try {
    const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const appointment = new Date(data.appointment.startsAt);
    form.querySelectorAll('[data-public-lead-step]').forEach((section) => { section.hidden = true; });
    document.querySelector('#publicLeadProgress').hidden = true;
    const dateText = appointment.toLocaleString('de-DE',{weekday:'long',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'});
    document.querySelector('#publicBookingSuccessText').textContent = data.appointment.calendarConnected
      ? `Dein Klarheitsgespräch findet am ${dateText} Uhr statt und wurde direkt im Kalender angelegt.`
      : `Dein Klarheitsgespräch am ${dateText} Uhr ist im CRM reserviert. Die persönliche Bestätigung mit dem Meet-Link folgt an ${form.elements.email.value}.`;
    document.querySelector('#publicBookingSuccess').hidden = false;
    clearTimeout(publicLeadDraftTimer);
    try { localStorage.removeItem(publicLeadDraftKey); } catch {}
    status.textContent = '';
    if (cookieConsentAllows('marketing') && typeof window.fbq === 'function') window.fbq('track', 'Lead');
  } catch (error) { status.textContent = error.message || 'Das hat nicht geklappt. Bitte versuche es erneut.'; status.className = 'form-status error'; }
  finally { button.disabled = false; }
});
