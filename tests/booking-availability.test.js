import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAvailableSlots, isWithinBookingAvailability, normalizeBookingSettings, zonedDateTimeToUtc } from '../lib/booking-availability.js';

const settings = {
  timezone: 'Europe/Berlin',
  weeklyAvailability: {
    0: [],
    1: [{ start: '16:00', end: '20:00' }],
    2: [{ start: '16:00', end: '20:00' }],
    3: [], 4: [], 5: [], 6: [],
  },
  slotIntervalMinutes: 15,
  defaultDurationMinutes: 45,
  minNoticeHours: 0,
  bookingHorizonDays: 180,
};

test('Berliner Buchungszeiten werden sommer- und winterzeitkorrekt nach UTC umgerechnet', () => {
  assert.equal(zonedDateTimeToUtc('2026-08-31', '16:00').toISOString(), '2026-08-31T14:00:00.000Z');
  assert.equal(zonedDateTimeToUtc('2027-01-04', '16:00').toISOString(), '2027-01-04T15:00:00.000Z');
});

test('Slots entstehen nur innerhalb der vom Admin freigegebenen Wochentage und Zeitfenster', () => {
  const slots = generateAvailableSlots({ settings, from: '2026-08-31', to: '2026-09-02', duration: 45, now: new Date('2026-08-30T00:00:00Z') });
  assert.equal(slots.length, 28);
  assert.equal(slots[0].start, '2026-08-31T14:00:00.000Z');
  assert.equal(slots.at(-1).start, '2026-09-01T17:15:00.000Z');
  assert.equal(slots.some((slot) => slot.date === '2026-09-02'), false);
});

test('Belegte Google-Kalenderzeiten werden aus der Slot-Liste herausgefiltert', () => {
  const slots = generateAvailableSlots({
    settings,
    from: '2026-08-31',
    to: '2026-08-31',
    duration: 45,
    now: new Date('2026-08-30T00:00:00Z'),
    busyIntervals: [{ start: '2026-08-31T14:30:00.000Z', end: '2026-08-31T15:30:00.000Z' }],
  });
  assert.equal(slots.length, 8);
  assert.equal(slots.some((slot) => slot.start === '2026-08-31T14:30:00.000Z'), false);
  assert.equal(slots.some((slot) => slot.start === '2026-08-31T15:30:00.000Z'), true);
});

test('Serverprüfung lehnt Termine außerhalb der Freigabe und des Rasters ab', () => {
  const now = new Date('2026-08-30T00:00:00Z');
  assert.equal(isWithinBookingAvailability('2026-08-31T16:00:00.000Z', 45, settings, now), true);
  assert.equal(isWithinBookingAvailability('2026-08-31T13:45:00.000Z', 45, settings, now), false);
  assert.equal(isWithinBookingAvailability('2026-08-31T17:30:00.000Z', 45, settings, now), false);
  assert.equal(isWithinBookingAvailability('2026-09-02T14:00:00.000Z', 45, settings, now), false);
});

test('Ungültige Admin-Zeitfenster werden nicht gespeichert', () => {
  assert.throws(() => normalizeBookingSettings({ weeklyAvailability: { 1: [{ start: '20:00', end: '16:00' }] } }), /gültige Start- und Endzeit/);
});
