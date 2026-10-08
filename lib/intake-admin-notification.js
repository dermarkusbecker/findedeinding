import { renderBrandedEmail } from './branded-email.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function intakeAdminNotification(lead, appearance = {}) {
  const appointment = new Date(lead.appointment_start).toLocaleString('de-DE', {
    dateStyle: 'full', timeStyle: 'short', timeZone: lead.appointment_timezone || 'Europe/Berlin',
  });
  const phone = String(lead.mobile_phone || lead.phone || '').trim();
  const subject = `Neue Anmeldung zum Klarheitsgespräch: ${lead.name}`;
  const body = `Hallo Markus,\n\n${lead.name} hat sich über das Intake-Verfahren angemeldet und ein Klarheitsgespräch gebucht.\n\nName: ${lead.name}\nE-Mail: ${lead.email}\nTelefon: ${phone || 'Nicht angegeben'}\nTermin: ${appointment} Uhr\nGoogle Meet: ${lead.meet_url || 'Link in der Interessentenakte öffnen'}\n\nDie Angaben und Antworten findest du in der Interessentenakte im CRM.`;
  const rendered = renderBrandedEmail({ subject, body, ...appearance });
  const dial = phone.replace(/[^+\d]/g, '').replace(/(?!^)\+/g, '');
  const html = phone && /^\+?\d{6,18}$/.test(dial)
    ? rendered.html.replace(`Telefon: ${escapeHtml(phone)}`, `Telefon: <a href="tel:${escapeHtml(dial)}" style="color:#0d7791;font-weight:700">${escapeHtml(phone)}</a>`)
    : rendered.html;
  return { subject, body: rendered.text, body_html: html, preview: `Neue Buchung am ${appointment} Uhr · ${phone || 'Telefon nicht angegeben'}` };
}
