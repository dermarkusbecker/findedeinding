const form = document.querySelector('#loginForm');
const status = document.querySelector('#loginStatus');
const recovery = new URLSearchParams(location.hash.slice(1));
const recoveryToken = recovery.get('type') === 'recovery' ? recovery.get('access_token') : '';
const initialPasswordChange = new URLSearchParams(location.search).get('change') === 'required';
if (recoveryToken) {
  form.querySelector('h2').textContent = 'Neues Passwort vergeben.';
  form.querySelector('h2 + p').textContent = 'Wähle ein neues Passwort mit mindestens acht Zeichen.';
  form.elements.identifier.closest('label').hidden = true;
  form.elements.identifier.required = false;
  form.elements.password.autocomplete = 'new-password';
  document.querySelector('#forgotPassword').hidden = true;
  form.querySelector('.submit').firstChild.textContent = 'Passwort speichern ';
} else if (initialPasswordChange) {
  form.querySelector('h2').textContent = 'Einmalpasswort ersetzen.';
  form.querySelector('h2 + p').textContent = 'Vergib jetzt dein persönliches Passwort mit mindestens acht Zeichen.';
  form.elements.identifier.closest('label').hidden = true;
  form.elements.identifier.required = false;
  form.elements.password.autocomplete = 'new-password';
  document.querySelector('#forgotPassword').hidden = true;
  form.querySelector('.submit').firstChild.textContent = 'Neues Passwort speichern ';
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
    if (initialPasswordChange) {
      status.textContent = 'Persönliches Passwort wird gespeichert …';
      const response = await fetch('/api/auth?action=change-initial-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.elements.password.value }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); location.replace(data.destination); return;
    }
    const response = await fetch('/api/auth?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); location.replace(data.destination);
  }
  catch (error) { status.textContent = error.message || 'Anmeldung fehlgeschlagen.'; button.disabled = false; }
});

document.querySelector('#forgotPassword').addEventListener('click', async () => {
  const identifier = form.elements.identifier.value.trim();
  if (!identifier) { status.textContent = 'Bitte zuerst deinen Login oder deine E-Mail-Adresse eingeben.'; form.elements.identifier.focus(); return; }
  status.textContent = 'E-Mail wird angefordert …';
  try {
    const response = await fetch('/api/auth?action=password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    status.textContent = data.message;
  } catch (error) { status.textContent = error.message || 'Die Anfrage konnte nicht verarbeitet werden.'; }
});
