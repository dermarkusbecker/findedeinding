const panels = document.querySelectorAll('[data-panel]');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const toast = document.querySelector('#toast');
const contactDialog = document.querySelector('#contactDialog');
const contactForm = document.querySelector('#contactForm');
const contactRows = document.querySelector('#contactRows');
let contacts = [];

async function requireSession() {
  const response = await fetch('/api/auth?action=session');
  if (!response.ok) location.replace('/login');
}

function showView(view) {
  panels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== view));
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  const current = document.querySelector(`[data-panel="${view}"] h1`);
  const breadcrumb = document.querySelector('.breadcrumb strong');
  if (current && breadcrumb) breadcrumb.textContent = current.textContent;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  toast.querySelector('span').textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2800);
}

navItems.forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
document.querySelectorAll('#newContact, [data-new-contact]').forEach((button) => button.addEventListener('click', () => contactDialog.showModal()));
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => contactDialog.close()));
document.querySelectorAll('.task-row input').forEach((input) => input.addEventListener('change', () => showToast(input.checked ? 'Aufgabe erledigt.' : 'Aufgabe wieder geöffnet.')));

const statusLabels = { lead: 'Lead', qualified: 'Qualifiziert', proposal: 'Angebot', won: 'Gewonnen', lost: 'Verloren' };
const statusClasses = { lead: 'grey', qualified: 'mint', proposal: 'warm', won: 'mint', lost: 'grey' };

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function renderContacts(query = '') {
  const needle = query.trim().toLowerCase();
  const visible = contacts.filter((contact) => `${contact.first_name} ${contact.last_name} ${contact.company || ''} ${contact.email || ''}`.toLowerCase().includes(needle));
  contactRows.innerHTML = visible.length ? visible.map((contact, index) => `<div class="table-row"><div class="contact-name"><div class="avatar ${index % 2 ? 'avatar-coral' : 'avatar-blue'}">${contact.first_name[0]}${contact.last_name[0]}</div><div><strong>${escapeHtml(contact.first_name)} ${escapeHtml(contact.last_name)}</strong><small>${escapeHtml(contact.email || '')}</small></div></div><span>${escapeHtml(contact.company || '—')}</span><span class="status-label ${statusClasses[contact.status] || 'grey'}">${statusLabels[contact.status] || contact.status}</span><span>${new Date(contact.created_at).toLocaleDateString('de-DE')}</span></div>`).join('') : '<div class="empty-state">Noch keine passenden Kontakte vorhanden.</div>';
  document.querySelector('#contactCount').textContent = `${contacts.length} ${contacts.length === 1 ? 'Kontakt' : 'Kontakte'} in deinem Netzwerk.`;
}

async function loadContacts() {
  const status = document.querySelector('#connectionStatus');
  try {
    const response = await fetch('/api/leads');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    contacts = data.leads.map((lead) => { const parts = lead.name.trim().split(/\s+/); return { ...lead, first_name: parts.shift() || '', last_name: parts.join(' ') || '—', company: lead.source, status: lead.status === 'new' ? 'lead' : lead.status }; });
    status.textContent = 'Supabase verbunden';
    status.className = 'connection-status connected';
    renderContacts();
  } catch (error) {
    status.textContent = 'Konfiguration ausstehend';
    status.className = 'connection-status error';
    contactRows.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'CRM nicht erreichbar.')}</div>`;
  }
}

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = contactForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(contactForm));
    const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${values.firstName} ${values.lastName}`, email: values.email, source: values.company || 'manuell', consent: true }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    contactDialog.close();
    contactForm.reset();
    showToast('Lead wurde in Supabase gespeichert.');
    await loadContacts();
    showView('contacts');
  } catch (error) {
    showToast(error.message || 'Kontakt konnte nicht gespeichert werden.');
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#contactSearch').addEventListener('input', (event) => renderContacts(event.target.value));
document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/auth?action=session', { method: 'DELETE' }); location.replace('/login'); });

const userDialog = document.querySelector('#userDialog');
const userForm = document.querySelector('#userForm');
document.querySelector('#newUser').addEventListener('click', () => userDialog.showModal());
document.querySelectorAll('[data-close-user]').forEach((button) => button.addEventListener('click', () => userDialog.close()));
async function loadUsers() {
  try { const response = await fetch('/api/users'); const data = await response.json(); if (!response.ok) throw new Error(data.error); document.querySelector('#userRows').innerHTML = data.users.length ? data.users.map((user, index) => `<div class="table-row"><div class="contact-name"><div class="avatar ${index % 2 ? 'avatar-coral' : 'avatar-blue'}">${escapeHtml(user.name.slice(0, 2).toUpperCase())}</div><strong>${escapeHtml(user.name)}</strong></div><span>${escapeHtml(user.email)}</span><span>${escapeHtml(user.role)}</span><span class="status-label ${user.status === 'active' ? 'mint' : 'warm'}">${escapeHtml(user.status)}</span></div>`).join('') : '<div class="empty-state">Noch keine Benutzer angelegt.</div>'; } catch (error) { document.querySelector('#userRows').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}
userForm.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(userForm))) }); const data = await response.json(); if (!response.ok) return showToast(data.error); userDialog.close(); userForm.reset(); showToast('Benutzer wurde angelegt.'); loadUsers(); });

requireSession().then(() => Promise.all([loadContacts(), loadUsers()]));

if (window.lucide) window.lucide.createIcons();
