const params = new URLSearchParams(location.search);
const form = document.querySelector('#leadForm');
const status = document.querySelector('#formStatus');
document.querySelector('.menu').addEventListener('click', () => document.querySelector('nav').classList.toggle('open'));
document.querySelectorAll('nav a').forEach((link) => link.addEventListener('click', () => document.querySelector('nav').classList.remove('open')));
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
