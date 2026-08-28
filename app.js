const panels = document.querySelectorAll('[data-panel]');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const toast = document.querySelector('#toast');

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
document.querySelector('#newContact').addEventListener('click', () => showToast('Kontakt-Dialog kommt als Nächstes.'));
document.querySelectorAll('.task-row input').forEach((input) => input.addEventListener('change', () => showToast(input.checked ? 'Aufgabe erledigt.' : 'Aufgabe wieder geöffnet.')));

if (window.lucide) window.lucide.createIcons();
