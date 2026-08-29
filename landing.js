const params = new URLSearchParams(location.search);
const form = document.querySelector('#leadForm');
const status = document.querySelector('#formStatus');
const menu = document.querySelector('.menu');
const navigation = document.querySelector('.site-header nav');

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
