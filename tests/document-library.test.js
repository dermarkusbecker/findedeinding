import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentLibrary, renderDocumentLibrary } from '../lib/document-library.js';

const program = {
  onboardingComplete: true,
  onboarding: { privacyDocumentId: 'privacy', commitmentDocumentId: 'commitment' },
  access: { completedWeeks: [1,2,3], weekStates: Array.from({ length: 8 }, (_, i) => ({ week: i+1, accessible: i < 4, unlocksAt: `2026-09-${String(i+1).padStart(2,'0')}` })) },
};
const docs = [
  { id: 'privacy', document_type: 'privacy_consent', week: 0 },
  { id: 'cv', document_type: 'cv', week: 1, source: 'customer' },
  { id: 'upload', document_type: 'workbook', week: 3, source: 'customer' },
  { id: 'halfway', document_type: 'shared', week: 4, source: 'staff', visibility: 'customer', display_title: 'Deine Halbzeitanalyse' },
  { id: 'internal', document_type: 'shared', week: 4, source: 'staff', visibility: 'staff' },
  { id: 'future', document_type: 'shared', week: 6, source: 'staff', visibility: 'customer' },
];

test('general documents precede the chronological program results without duplicates', () => {
  const model = buildDocumentLibrary(program, { documents: [...docs, docs[0]] });
  assert.deepEqual(model.groups.map((group) => group.documents.map((doc) => doc.id)), [['privacy'], ['commitment'], ['cv'], ['upload']]);
  assert.deepEqual(model.weeks[3].documents.map((doc) => doc.id), ['halfway']);
  assert.equal(model.total, 5);
  assert.deepEqual(model.weeks.map((week) => week.daysAfterStart), [0,7,14,21,28,35,42,49]);
});

test('locked and internal files never become clickable, including in admin preview data', () => {
  const html = renderDocumentLibrary(buildDocumentLibrary(program, { documents: docs }));
  assert.match(html, /data-document-id="halfway"/);
  assert.doesNotMatch(html, /data-document-id="(?:future|internal)"/);
  assert.equal((html.match(/class="library-milestone /g) || []).length, 8);
  assert.match(html, /21 Tage nach Start/);
  assert.match(html, /Nach der Verdichtung/);
});

test('released weeks without files show preparation rather than a false open button', () => {
  const model = buildDocumentLibrary(program, { documents: [] });
  assert.equal(model.weeks[3].accessible, true);
  assert.equal(model.weeks[3].documents.length, 0);
  const html = renderDocumentLibrary(model);
  assert.match(html, /Woche freigeschaltet/);
  assert.match(html, /Dein Ergebnis entsteht hier/);
  assert.match(html, /Noch gesperrt/);
  assert.doesNotMatch(html, /data-document-id="undefined"/);
});

test('document names and preview attributes are escaped; file controls use native buttons', () => {
  const html = renderDocumentLibrary(buildDocumentLibrary(program, { documents: [{ id: 'x" onclick="evil', week: 0, display_title: '<script>alert(1)</script>' }] }));
  assert.doesNotMatch(html, /<script>| onclick="evil/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<button type="button" class="library-file" data-document-preview/);
});

test('empty account retains all general categories and eight planned weeks', () => {
  const model = buildDocumentLibrary({}, null);
  assert.equal(model.groups.length, 4);
  assert.equal(model.weeks.length, 8);
  assert.equal(model.total, 0);
  assert.equal(model.weeks.filter((week) => week.accessible).length, 0);
  assert.match(renderDocumentLibrary(model), /Termin folgt mit deinem Programmstart/);
});

test('personal documents and weekly insight files have separate views without exposing locked files', async () => {
  const { renderInsightDocuments } = await import('../lib/document-library.js');
  const model = buildDocumentLibrary(program, { documents: docs });
  const personal = renderDocumentLibrary(model, { generalOnly: true });
  const insights = renderInsightDocuments(model);
  assert.match(personal, /data-document-id="cv"/);
  assert.doesNotMatch(personal, /data-document-id="halfway"|library-timeline/);
  assert.match(insights, /data-document-id="halfway"/);
  assert.doesNotMatch(insights, /data-document-id="(?:cv|privacy|commitment|future|internal)"/);
  assert.equal(renderInsightDocuments(buildDocumentLibrary({}, {})), '');
});
