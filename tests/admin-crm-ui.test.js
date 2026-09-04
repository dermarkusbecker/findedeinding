import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../admin.html', import.meta.url);
const scriptUrl = new URL('../admin.js', import.meta.url);
const stylesUrl = new URL('../admin-crm-refresh.css', import.meta.url);

test('CRM lädt das große, lesbare Admin-Design', async () => {
  const [html, styles] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);
  assert.match(html, /admin-crm-refresh\.css/);
  assert.match(styles, /body\s*\{[^}]*font-size:\s*14px/s);
  assert.match(styles, /\.card-head h2[^}]*font-size:\s*20px/s);
  assert.match(styles, /\.table-data[^}]*font-size:\s*12px/s);
});

test('CRM besitzt eine kontextabhängige zweite Navigation', async () => {
  const [html, script, styles] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);
  assert.match(html, /class="context-nav" aria-label="Unterkategorien"/);
  assert.match(script, /const contextNavigation = \{/);
  for (const view of ['command', 'participants', 'clarity', 'gates', 'escalations', 'leads', 'users', 'settings']) {
    assert.match(script, new RegExp(`${view}:\\{`));
  }
  assert.doesNotMatch(html, /data-view="benni"/i);
  assert.doesNotMatch(script, /benni/i);
  assert.match(script, /showSettingsPanel\(button\.dataset\.contextSettings\)/);
  assert.match(script, /scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
  assert.match(styles, /\.context-nav\s*\{/);
});

test('CRM verwendet Kunden und Interessenten und bietet editierbare Klarheitsfragen', async () => {
  const [html, script] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
  ]);
  assert.match(html, /data-view="participants"[^>]*>[\s\S]*?Kunden/);
  assert.match(html, /data-view="leads"[^>]*>[\s\S]*?Interessenten/);
  assert.match(html, /data-settings-tab="questions"/);
  assert.match(html, /data-settings-panel="questions"/);
  assert.match(html, /id="clarityQuestionList"/);
  assert.match(script, /fetch\('\/api\/clarity\?action=settings'/);
  assert.match(script, /Kundenprogramme verwalten/);
});

test('zweite Navigation bleibt auf kleinen Bildschirmen nutzbar', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  const mobile = styles.slice(styles.indexOf('@media (max-width: 800px)'));
  assert.match(mobile, /\.context-nav\s*\{[^}]*position:\s*static/s);
  assert.match(mobile, /\.context-body nav\s*\{[^}]*grid-template-columns:\s*repeat\(2, 1fr\)/s);
});
