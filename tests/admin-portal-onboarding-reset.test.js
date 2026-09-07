import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession, sessionFromRequest } from '../lib/auth.js';
import { artifactIsAfterOnboardingReset } from '../lib/onboarding-reset.js';

process.env.AUTH_SECRET = 'admin-preview-test-secret-with-32-characters';
const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('zeitlich begrenzter Admin-Kundenzugang bleibt vom normalen Kundenlogin getrennt', () => {
  const participantId = '11111111-1111-4111-8111-111111111111';
  const adminId = '22222222-2222-4222-8222-222222222222';
  const token = createSession('kunde@example.de', 'user', { profileId: participantId, participantId, permissions: ['customer_portal', 'clara_program'], adminPreview: true, adminProfileId: adminId }, 30 * 60 * 1000);
  const session = sessionFromRequest({ headers: { authorization: `Bearer ${token}` }, query: {} });
  assert.equal(session.participantId, participantId);
  assert.equal(session.adminProfileId, adminId);
  assert.equal(session.adminPreview, true);
  assert.ok(session.expires <= Date.now() + 30 * 60 * 1000);
});

test('Admin öffnet das Kundenportal mit sichtbarer Reset-Aktion und Bestätigungsfenster', async () => {
  const [adminHtml, adminClient, authApi, portalRoute, portalHtml, portalClient, styles] = await Promise.all([
    file('admin.html'), file('admin.js'), file('api/auth.js'), file('api/portal.js'), file('portal.html'), file('portal.js'), file('portal.css'),
  ]);
  assert.match(adminHtml, /id="openCustomerPortal"/);
  assert.match(adminClient, /action=customer-preview&participantId=/);
  assert.match(authApi, /requireCurrentAdmin\(request, response, \['customers', 'program'\]\)/);
  assert.match(authApi, /adminPreview: true/);
  assert.match(portalRoute, /sessionFromToken\(previewToken\)/);
  for (const id of ['adminPreviewBar', 'adminResetOnboarding', 'adminOnboardingResetDialog', 'confirmAdminOnboardingReset']) assert.match(portalHtml, new RegExp(`id="${id}"`));
  assert.match(portalClient, /action: 'admin_reset_onboarding'/);
  assert.match(portalClient, /headers\.Authorization = `Bearer \$\{adminPreviewToken\}`/);
  assert.match(styles, /\.admin-preview-bar/);
  assert.match(styles, /\.admin-onboarding-reset-dialog/);
});

test('Reset ist serverseitig admin-geschützt und archivierte Onboarding-Dokumente zählen nicht erneut', async () => {
  const [participantApi, programApi, resetService, privacyService, migration] = await Promise.all([
    file('api/participant-program.js'), file('api/program-control.js'), file('lib/onboarding-reset.js'), file('lib/privacy-consent.js'), file('supabase/migrations/20260907140000_admin_portal_onboarding_reset.sql'),
  ]);
  assert.match(participantApi, /assertActivePreviewAdmin\(result\.service, session\)/);
  assert.match(participantApi, /resetParticipantOnboarding/);
  assert.match(programApi, /adminProfileId: admin\.profile\.id/);
  assert.match(resetService, /onboarding_reset_at: resetAt/);
  assert.match(resetService, /Number\(gate\.week\) === 0/);
  assert.doesNotMatch(privacyService, /if \(existing\) return existing/);
  assert.match(migration, /onboarding_reset_at timestamptz/);
  const resetAt = '2026-09-07T12:00:00.000Z';
  assert.equal(artifactIsAfterOnboardingReset({ created_at: '2026-09-07T11:59:59.000Z' }, resetAt), false);
  assert.equal(artifactIsAfterOnboardingReset({ created_at: '2026-09-07T12:00:01.000Z' }, resetAt), true);
});
