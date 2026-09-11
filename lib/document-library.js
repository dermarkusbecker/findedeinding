import { buildJourneyWeeks } from './journey-weeks.js';

const generalTypes = ['privacy_consent', 'start_commitment', 'cv'];
const milestones = {
  4: { title: 'Deine Halbzeitanalyse', requirement: 'Nach Abschluss und Auswertung von Woche 4' },
  6: { title: 'Deine Dein-Ding-Map', requirement: 'Nach der Verdichtung deiner Ergebnisse in Woche 6' },
  8: { title: 'Dein Abschlussdossier', requirement: 'Nach deinem Umsetzungs-Commitment und Abschluss von Woche 8' },
};

export function buildDocumentLibrary(program = {}, workspace = {}) {
  const weeks = buildJourneyWeeks(program);
  const seen = new Set();
  const documents = (workspace?.documents || []).filter((doc) => {
    if (!doc.id || seen.has(doc.id) || doc.visibility === 'staff') return false;
    const week = Number(doc.week || 0);
    if (week > 0 && !weeks.find((item) => item.week === week)?.accessible) return false;
    seen.add(doc.id);
    return true;
  });
  for (const [key, type, title] of [
    ['privacyDocumentId', 'privacy_consent', 'Datenschutzinformation & Einwilligung'],
    ['commitmentDocumentId', 'start_commitment', 'Mein persönliches Commitment'],
  ]) {
    const id = program.onboarding?.[key];
    if (id && !seen.has(id)) {
      documents.push({ id, week: 0, document_type: type, display_title: title, mime_type: 'application/pdf', visibility: 'customer' });
      seen.add(id);
    }
  }
  const isGeneral = (doc) => generalTypes.includes(doc.document_type) || doc.source === 'customer' || Number(doc.week || 0) === 0;
  const general = documents.filter(isGeneral);
  return {
    total: documents.length,
    groups: [
      { title: 'Datenschutz', description: 'Deine Einwilligung und Datenschutzunterlagen', documents: general.filter((doc) => doc.document_type === 'privacy_consent'), empty: 'Deine bestätigte Einwilligung erscheint hier.' },
      { title: 'Dein Commitment', description: 'Deine persönliche Vereinbarung zum Start', documents: general.filter((doc) => doc.document_type === 'start_commitment'), empty: 'Dein bestätigtes Commitment erscheint hier.' },
      { title: 'Dein Lebenslauf', description: 'Deine Erfahrungen als Ausgangspunkt', documents: general.filter((doc) => doc.document_type === 'cv'), empty: 'Hier findest du deinen Lebenslauf nach dem Upload.' },
      { title: 'Weitere Unterlagen', description: 'Deine Uploads und allgemeinen Dokumente', documents: general.filter((doc) => !generalTypes.includes(doc.document_type)), empty: 'Hier sammeln sich deine weiteren Dateien.' },
    ],
    weeks: weeks.map((week) => ({ ...week, milestone: milestones[week.week], daysAfterStart: (week.week - 1) * 7, documents: documents.filter((doc) => !isGeneral(doc) && Number(doc.week) === week.week) })),
    contracts: workspace?.contracts || [],
  };
}

const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fileIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16h14V8Zm0 0v5h5M8 12h8M8 16h6"/></svg>';
const dateLabel = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const documentButton = (doc) => {
  const title = doc.display_title || doc.original_file_name || 'Dokument';
  const file = doc.original_file_name || `${title}.pdf`;
  const meta = [doc.source === 'customer' ? 'Von dir hochgeladen' : 'Für dich verfügbar', dateLabel(doc.created_at?.slice(0, 10))].filter(Boolean).join(' · ');
  return `<button type="button" class="library-file" data-document-preview data-document-id="${escape(doc.id)}" data-document-title="${escape(title)}" data-document-file="${escape(file)}" data-document-mime="${escape(doc.mime_type || '')}" aria-haspopup="dialog"><span class="library-file-icon">${fileIcon}</span><span class="library-file-copy"><strong>${escape(title)}</strong><small>${escape(meta)}</small></span><span class="library-file-open">Öffnen ↗</span></button>`;
};

export function renderDocumentLibrary(model) {
  const released = model.weeks.filter((week) => week.accessible).length;
  const groups = model.groups.map((group, index) => `<section class="library-group" aria-labelledby="libraryGroup${index}"><header><span class="library-group-icon">${fileIcon}</span><div><h3 id="libraryGroup${index}">${group.title}</h3><p>${group.description}</p></div><span class="library-count">${group.documents.length}</span></header><div class="library-files">${group.documents.length ? group.documents.map(documentButton).join('') : `<p class="library-empty">${group.empty}</p>`}</div></section>`).join('');
  const contracts = model.contracts.length ? `<div class="library-contracts">${model.contracts.map((contract) => `<p><strong>${escape(contract.title || 'Vertrag')}</strong><span>Vertrag: ${contract.document_confirmed_at ? 'bestätigt' : 'offen'} · Videovertrag: ${contract.video_contract_confirmed_at ? 'bestätigt' : 'offen'}</span></p>`).join('')}</div>` : '';
  const timeline = model.weeks.map((week) => {
    const state = week.accessible ? (week.documents.length ? 'available' : 'released') : 'locked';
    const date = dateLabel(week.unlocksAt);
    const status = week.accessible ? (week.documents.length ? `${week.documents.length} ${week.documents.length === 1 ? 'Dokument verfügbar' : 'Dokumente verfügbar'}` : 'Woche freigeschaltet') : 'Noch gesperrt';
    const title = week.milestone?.title || week.summary.title;
    const content = week.documents.length ? week.documents.map(documentButton).join('') : `<div class="library-pending">${fileIcon}<p><strong>${week.milestone ? 'Dein Ergebnis entsteht hier' : 'Raum für deine Ergebnisse'}</strong><small>${week.milestone ? escape(week.milestone.requirement) : 'Sobald dir Unterlagen zu dieser Woche bereitgestellt werden, kannst du sie hier öffnen.'}</small></p></div>`;
    return `<li class="library-milestone is-${state}"><div class="library-time"><span>WOCHE ${String(week.week).padStart(2, '0')}</span><strong>${week.daysAfterStart ? `${week.daysAfterStart} Tage nach Start` : 'Dein Start'}</strong><small>${date ? `Ab ${date}` : 'Termin folgt mit deinem Programmstart'}</small>${week.completed ? '<em>✓ Woche abgeschlossen</em>' : ''}</div><span class="library-node" aria-hidden="true">${week.accessible ? '✓' : '·'}</span><section class="library-stage"><header><div><p>${escape(week.summary.mode || 'Dein Prozess')}</p><h3>${escape(title)}</h3></div><span class="library-status">${status}</span></header>${content}</section></li>`;
  }).join('');
  return `<section class="library-general" aria-labelledby="libraryGeneralTitle"><header class="library-section-heading"><div><p>DEIN FUNDAMENT</p><h2 id="libraryGeneralTitle">Alles Wichtige. An einem Ort.</h2></div><span>${model.total} ${model.total === 1 ? 'Dokument' : 'Dokumente'} in deiner Akte</span></header><div class="library-general-grid">${groups}</div>${contracts}</section><section class="library-journey" aria-labelledby="libraryJourneyTitle"><header class="library-section-heading"><div><p>DEIN WEG IN DOKUMENTEN</p><h2 id="libraryJourneyTitle">Mit jeder Woche wächst dein Bild.</h2><small>Alle sieben Tage öffnet sich eine neue Woche. Deine Ergebnisse erscheinen hier, sobald sie erstellt und für dich bereitgestellt sind.</small></div><span>${released} / 8 Wochen freigeschaltet</span></header><div class="library-legend"><span>✓ Freigeschaltet</span><span>↗ Dokument öffnen</span><span>○ Noch gesperrt</span></div><ol class="library-timeline">${timeline}</ol></section>`;
}
