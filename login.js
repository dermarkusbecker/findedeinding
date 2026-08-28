const form = document.querySelector('#loginForm');
const status = document.querySelector('#loginStatus');
fetch('/api/auth/session').then((response) => { if (response.ok) location.replace('/admin'); });
form.addEventListener('submit', async (event) => {
  event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; status.textContent = 'Anmeldung wird geprüft …';
  try { const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); location.replace('/admin'); }
  catch (error) { status.textContent = error.message || 'Anmeldung fehlgeschlagen.'; button.disabled = false; }
});
