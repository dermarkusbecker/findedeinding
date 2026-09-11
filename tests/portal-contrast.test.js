import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../portal-journey.css', import.meta.url), 'utf8');

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('Onboarding-Versprechen hat lesbare helle Schrift auf der dunklen Clara-Karte', () => {
  assert.match(css, /\.onboarding-welcome \.promise strong \{[\s\S]*?color: #f7fbfd;[\s\S]*?font-size: 15px;/);
  assert.ok(contrast('#f7fbfd', '#031622') >= 4.5);
});

test('Kontrastaudit deckt alle dunklen Bereiche des Kundenportals ab', () => {
  for (const selector of [
    '.pre-onboarding-dashboard h2',
    '.dashboard-week-tile b',
    '.journey-grid .week-card p',
    '.documents article small',
    '.support-grid article p',
    '#activeWeek .clara-message p',
    '.clarity-dialog-hint',
  ]) assert.ok(css.includes(selector), `${selector} fehlt im Kontrastaudit`);
});

test('Hinweise in dunklen Karten verwenden keine Kleinstschrift mehr', () => {
  assert.match(css, /\.gate-header small \{[^}]*font-size: 11px/s);
  assert.match(css, /#activeWeek \.clara-step-control span \{[^}]*font-size: 12px/s);
  assert.match(css, /\.clarity-dialog-hint \{[^}]*font-size: 11px/s);
});
