const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALLOWED_DURATIONS = [30, 45, 60, 90];
const ALLOWED_INTERVALS = [15, 30];

export const DEFAULT_BOOKING_SETTINGS = Object.freeze({
  timezone: 'Europe/Berlin',
  weeklyAvailability: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
  slotIntervalMinutes: 15,
  defaultDurationMinutes: 45,
  minNoticeHours: 24,
  bookingHorizonDays: 60,
});

const asInteger = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

function minutes(value) {
  const match = TIME_PATTERN.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeWindows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((window) => {
    const start = typeof window?.start === 'string' ? window.start : '';
    const end = typeof window?.end === 'string' ? window.end : '';
    if (minutes(start) === null || minutes(end) === null || minutes(start) >= minutes(end)) {
      throw Object.assign(new Error('Jedes Zeitfenster benötigt eine gültige Start- und Endzeit.'), { status: 400 });
    }
    return { start, end };
  }).sort((a, b) => minutes(a.start) - minutes(b.start));
}

export function normalizeBookingSettings(value = {}) {
  const weeklySource = value.weeklyAvailability || value.weekly_availability || {};
  const weeklyAvailability = {};
  for (let day = 0; day <= 6; day += 1) weeklyAvailability[day] = normalizeWindows(weeklySource[day] || weeklySource[String(day)] || []);
  const slotIntervalMinutes = asInteger(value.slotIntervalMinutes ?? value.slot_interval_minutes, 15, 15, 30);
  if (!ALLOWED_INTERVALS.includes(slotIntervalMinutes)) throw Object.assign(new Error('Terminraster muss 15 oder 30 Minuten betragen.'), { status: 400 });
  const defaultDurationMinutes = asInteger(value.defaultDurationMinutes ?? value.default_duration_minutes, 45, 30, 90);
  if (!ALLOWED_DURATIONS.includes(defaultDurationMinutes)) throw Object.assign(new Error('Standarddauer ist ungültig.'), { status: 400 });
  return {
    timezone: 'Europe/Berlin',
    weeklyAvailability,
    slotIntervalMinutes,
    defaultDurationMinutes,
    minNoticeHours: asInteger(value.minNoticeHours ?? value.min_notice_hours, 24, 0, 168),
    bookingHorizonDays: asInteger(value.bookingHorizonDays ?? value.booking_horizon_days, 60, 7, 180),
  };
}

function dateKeyParts(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!match) throw Object.assign(new Error('Ungültiger Datumsbereich.'), { status: 400 });
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== dateKey) throw Object.assign(new Error('Ungültiger Datumsbereich.'), { status: 400 });
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function timezoneOffset(date, timezone) {
  const parts = localParts(date, timezone);
  const { year, month, day } = dateKeyParts(parts.dateKey);
  return Date.UTC(year, month - 1, day, parts.hour, parts.minute, parts.second) - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedDateTimeToUtc(dateKey, time, timezone = 'Europe/Berlin') {
  const { year, month, day } = dateKeyParts(dateKey);
  const totalMinutes = minutes(time);
  if (totalMinutes === null) throw Object.assign(new Error('Ungültige Uhrzeit.'), { status: 400 });
  const localTimestamp = Date.UTC(year, month - 1, day, Math.floor(totalMinutes / 60), totalMinutes % 60);
  let candidate = localTimestamp - timezoneOffset(new Date(localTimestamp), timezone);
  candidate = localTimestamp - timezoneOffset(new Date(candidate), timezone);
  return new Date(candidate);
}

function dateKeys(from, to) {
  const first = dateKeyParts(from), last = dateKeyParts(to);
  const cursor = new Date(Date.UTC(first.year, first.month - 1, first.day));
  const end = new Date(Date.UTC(last.year, last.month - 1, last.day));
  if (end < cursor || end.getTime() - cursor.getTime() > 31 * 86400000) throw Object.assign(new Error('Der angefragte Datumsbereich ist zu groß.'), { status: 400 });
  const keys = [];
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function busyCollision(start, end, busyIntervals) {
  return busyIntervals.some((busy) => start < new Date(busy.end) && end > new Date(busy.start));
}

export function generateAvailableSlots({ settings: rawSettings, from, to, duration, busyIntervals = [], now = new Date() }) {
  const settings = normalizeBookingSettings(rawSettings);
  const durationMinutes = Number(duration || settings.defaultDurationMinutes);
  if (!ALLOWED_DURATIONS.includes(durationMinutes)) throw Object.assign(new Error('Termindauer ist ungültig.'), { status: 400 });
  const earliest = new Date(now.getTime() + settings.minNoticeHours * 3600000);
  const latest = new Date(now.getTime() + settings.bookingHorizonDays * 86400000);
  const slots = [];
  for (const dateKey of dateKeys(from, to)) {
    const { year, month, day } = dateKeyParts(dateKey);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    for (const window of settings.weeklyAvailability[weekday]) {
      const windowStart = minutes(window.start), windowEnd = minutes(window.end);
      for (let cursor = windowStart; cursor + durationMinutes <= windowEnd; cursor += settings.slotIntervalMinutes) {
        const time = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
        const start = zonedDateTimeToUtc(dateKey, time, settings.timezone);
        const end = new Date(start.getTime() + durationMinutes * 60000);
        if (start < earliest || start > latest || busyCollision(start, end, busyIntervals)) continue;
        slots.push({ start: start.toISOString(), end: end.toISOString(), date: dateKey, time });
      }
    }
  }
  return slots;
}

export function isWithinBookingAvailability(startValue, duration, rawSettings, now = new Date()) {
  const settings = normalizeBookingSettings(rawSettings);
  const start = new Date(startValue), durationMinutes = Number(duration);
  if (Number.isNaN(start.getTime()) || !ALLOWED_DURATIONS.includes(durationMinutes)) return false;
  const earliest = new Date(now.getTime() + settings.minNoticeHours * 3600000);
  const latest = new Date(now.getTime() + settings.bookingHorizonDays * 86400000);
  if (start < earliest || start > latest) return false;
  const local = localParts(start, settings.timezone);
  if (local.second !== 0) return false;
  const { year, month, day } = dateKeyParts(local.dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const startMinute = local.hour * 60 + local.minute;
  return settings.weeklyAvailability[weekday].some((window) => {
    const windowStart = minutes(window.start), windowEnd = minutes(window.end);
    return startMinute >= windowStart
      && startMinute + durationMinutes <= windowEnd
      && (startMinute - windowStart) % settings.slotIntervalMinutes === 0;
  });
}
