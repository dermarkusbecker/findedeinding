const form = document.querySelector('#accessChoice');
const button = form.querySelector('button');
const note = document.querySelector('#sessionNote');
const destinations = { admin: '/login?auswahl=admin', customer: '/kunden-login?zugang=kunde', participant: '/kunden-login?zugang=teilnehmer' };

form.addEventListener('change', () => { button.disabled = !new FormData(form).get('access'); });
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const selected = new FormData(form).get('access');
  if (destinations[selected]) location.assign(destinations[selected]);
});

fetch('/api/auth/session').then(async (response) => {
  if (!response.ok) return;
  const data = await response.json();
  const role = data.user?.role === 'admin' ? 'Admin' : 'Teilnehmer';
  note.textContent = `Es besteht bereits eine ${role}-Sitzung. Du wirst trotzdem erst nach deiner Auswahl und Bestätigung weitergeleitet.`;
  note.classList.remove('hidden');
});
