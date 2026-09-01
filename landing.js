const params = new URLSearchParams(location.search);
const form = document.querySelector('#leadForm');
const status = document.querySelector('#formStatus');
const menu = document.querySelector('.menu');
const navigation = document.querySelector('.site-header nav');

menu?.addEventListener('click', () => {
  const isOpen = navigation.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(isOpen));
  menu.setAttribute('aria-label', isOpen ? 'Menü schließen' : 'Menü öffnen');
});

const choiceContent = {
  direction: {
    card: 'Deine Richtung',
    title: 'Du musst die Antwort noch nicht kennen.',
    text: 'Wir beginnen bei dem, was bereits da ist: deiner Geschichte, deinen Wünschen und den Momenten, die dir Energie geben.'
  },
  options: {
    card: 'Deine Kriterien',
    title: 'Nicht jede gute Idee ist auch deine.',
    text: 'Gemeinsam machen wir sichtbar, welche Möglichkeiten wirklich zu dir passen – und nach welchen Kriterien du klar entscheiden kannst.'
  },
  courage: {
    card: 'Dein nächster Schritt',
    title: 'Aus einem Ziel wird ein gangbarer Weg.',
    text: 'Wir übersetzen deine Richtung in kleine, belastbare Schritte. So entsteht Bewegung, ohne dass du heute schon alles riskieren musst.'
  },
  change: {
    card: 'Dein neues Bild',
    title: 'Dein Gefühl ist ein guter Anfang.',
    text: 'Wir schauen ehrlich auf das, was nicht mehr passt, und entwickeln daraus ein Bild davon, wie dein Leben stattdessen aussehen soll.'
  }
};

document.querySelectorAll('.choice').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.choice').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  const content = choiceContent[button.dataset.choice];
  document.querySelector('#resultCardTitle').textContent = content.card;
  document.querySelector('#resultTitle').textContent = content.title;
  document.querySelector('#resultText').textContent = content.text;
}));

const processContent = [
  ['WOCHE 1–2 · VERSTEHEN', 'Deine Geschichte wird zur stärksten Datenquelle.', 'Clara führt dich durch deine Wünsche, Stationen und Erfahrungen. Du antwortest in deinen eigenen Worten.', 'Was soll nach diesen acht Wochen anders sein als heute?', 'Ein klares Fundament'],
  ['WOCHE 3–4 · ERKENNEN', 'Du erkennst, was dich wirklich bewegt.', 'Energiequellen, natürliche Stärken und wiederkehrende Muster werden miteinander verbunden.', 'Bei welcher Tätigkeit vergisst du manchmal die Zeit?', 'Deine persönlichen Muster'],
  ['WOCHE 5–6 · VERDICHTEN', 'Aus Erkenntnissen werden echte Kriterien.', 'Du schärfst dein gewünschtes Leben, deine Werte und das, was für dich nicht mehr verhandelbar ist.', 'Woran würdest du merken, dass eine Richtung wirklich zu dir passt?', 'Deine Ding-Map'],
  ['WOCHE 7–8 · ENTSCHEIDEN', 'Aus Möglichkeiten wird deine Richtung.', 'Du vergleichst tragfähige Optionen, triffst deine Entscheidung und übersetzt sie in einen konkreten Plan.', 'Welcher kleine Schritt würde deine Entscheidung heute real machen?', 'Dein 90-Tage-Plan']
];

document.querySelectorAll('.process-tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.process-tab').forEach((item) => {
    item.classList.remove('active');
    item.setAttribute('aria-selected', 'false');
  });
  button.classList.add('active');
  button.setAttribute('aria-selected', 'true');
  const [label, title, text, question, outcome] = processContent[Number(button.dataset.step)];
  document.querySelector('#processLabel').textContent = label;
  document.querySelector('#processTitle').textContent = title;
  document.querySelector('#processText').textContent = text;
  document.querySelector('#processQuestion').textContent = question;
  document.querySelector('#processOutcome').textContent = outcome;
}));

document.querySelectorAll('.site-header nav a').forEach((link) => link.addEventListener('click', () => {
  navigation.classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Menü öffnen');
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
