import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('customer messages have one compact renderer and open the full message',async()=>{
  const [admin,log,html,css]=await Promise.all(['admin.js','admin-communication-log.js','admin.html','admin-message-list.css'].map(source));
  assert.doesNotMatch(admin,/querySelector\('#customerMessagePage'\)\.innerHTML/);
  assert.match(log,/data-open-communication/);
  assert.doesNotMatch(log,/<article class="communication-log-entry"/);
  assert.match(log,/window\.openCrmEmail\(record/);
  assert.match(html,/id="customerMessageSearch"/);
  assert.match(css,/\.customer-message-list \.crm-message-row/);
});

test('lead messages can be searched without expanding the list',async()=>{
  const [admin,html]=await Promise.all(['admin.js','admin.html'].map(source));
  assert.match(html,/id="leadMessageSearch"/);
  assert.match(admin,/const emails=query\?all\.filter/);
  assert.match(admin,/data-lead-email-id/);
  assert.match(admin,/openCrmEmail\(item,activeLeadDashboard\.lead\.email/);
});
