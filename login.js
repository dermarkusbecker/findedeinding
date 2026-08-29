const form = document.querySelector('#loginForm');
const status = document.querySelector('#loginStatus');
const recovery = new URLSearchParams(location.hash.slice(1));
const recoveryToken = recovery.get('type') === 'recovery' ? recovery.get('access_token') : '';
if (recoveryToken) {
  form.querySelector('h2').textContent = 'Neues Passwort vergeben.';
  form.querySelector('h2 + p').textContent = 'Wähle ein neues Passwort mit mindestens acht Zeichen.';
  form.elements.email.closest('label').hidden = true;
  form.elements.email.required = false;
  form.elements.password.autocomplete = 'new-password';
  document.querySelector('#forgotPassword').hidden = true;
  form.querySelector('.submit').firstChild.textContent = 'Passwort speichern ';
}
form.addEventListener('submit', async (event) => {
  event.preventDefault(); const button = form.querySelector('.submit'); button.disabled = true; status.textContent = 'Anmeldung wird geprüft …';
  try {
    if (recoveryToken) {
      status.textContent = 'Neues Passwort wird gespeichert …';
      const response = await fetch('/api/auth?action=update-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: recoveryToken, password: form.elements.password.value }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      history.replaceState(null, '', '/login'); form.reset(); status.textContent = 'Passwort gespeichert. Du kannst dich jetzt anmelden.'; setTimeout(() => location.replace('/login'), 1200); return;
    }
    const response = await fetch('/api/auth?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); location.replace(data.destination);
  }
  catch (error) { status.textContent = error.message || 'Anmeldung fehlgeschlagen.'; button.disabled = false; }
});

document.querySelector('#forgotPassword').addEventListener('click', async () => {
  const email = form.elements.email.value.trim();
  if (!email) { status.textContent = 'Bitte zuerst deine E-Mail-Adresse eingeben.'; form.elements.email.focus(); return; }
  status.textContent = 'E-Mail wird angefordert …';
  try {
    const response = await fetch('/api/auth?action=password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    status.textContent = data.message;
  } catch (error) { status.textContent = error.message || 'Die Anfrage konnte nicht verarbeitet werden.'; }
});
