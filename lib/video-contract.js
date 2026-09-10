import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const VIDEO_CONTRACT_TEMPLATE_FILE = 'FDD-VTR-001_B2C-Videovertrag_Finde-Dein-Ding_V1.0.pdf';
export const VIDEO_CONTRACT_TEMPLATE_URL = `/assets/forms/${VIDEO_CONTRACT_TEMPLATE_FILE}`;

const clean = (value, max = 1000) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

export const VIDEO_CONFIRMATION_KEYS = Object.freeze(Array.from({ length: 11 }, (_, index) => `v${String(index + 1).padStart(2, '0')}`));

export function normalizeVideoContract(input = {}, lead = {}) {
  const answers = Object.fromEntries(VIDEO_CONFIRMATION_KEYS.map((key) => [key, input.answers?.[key] === true || input.answers?.[key] === 'yes']));
  const contract = {
    tariffId: clean(input.tariffId, 80),
    providerEmail: clean(input.providerEmail || process.env.CONTRACT_PROVIDER_EMAIL || '', 240),
    providerPhone: clean(input.providerPhone || process.env.CONTRACT_PROVIDER_PHONE || '', 80),
    customerName: clean(input.customerName || lead.name, 180),
    birthDate: clean(input.birthDate, 10),
    street: clean(input.street, 220),
    postalCity: clean(input.postalCity, 180),
    customerEmail: clean(input.customerEmail || lead.email, 240),
    customerPhone: clean(input.customerPhone || lead.phone, 80),
    meetingAt: clean(input.meetingAt || lead.appointment_start, 60),
    product: clean(input.product || 'Finde dein Ding · 8-Wochen-Programm', 240),
    serviceStart: clean(input.serviceStart, 10),
    duration: clean(input.duration || '8 Wochen', 120),
    totalPrice: clean(input.totalPrice, 80),
    paymentModel: clean(input.paymentModel, 180),
    paymentDue: clean(input.paymentDue, 180),
    additionalServices: clean(input.additionalServices, 800),
    privacyUrl: clean(input.privacyUrl || process.env.PUBLIC_PRIVACY_URL || '', 400),
    revocationEmail: clean(input.revocationEmail || process.env.CONTRACT_PROVIDER_EMAIL || '', 240),
    additionalAgreements: clean(input.additionalAgreements, 800),
    place: clean(input.place, 120),
    contractDate: clean(input.contractDate, 10),
    consumerConfirmed: input.consumerConfirmed === true,
    recordingConsent: input.recordingConsent === true,
    recordingPurposeAccepted: input.recordingPurposeAccepted === true,
    recordingRevocationAccepted: input.recordingRevocationAccepted === true,
    priorInformationConfirmed: input.priorInformationConfirmed === true,
    emailConfirmed: input.emailConfirmed === true,
    immediateStart: input.immediateStart === true,
    serviceRevocationUnderstood: input.serviceRevocationUnderstood === true,
    digitalContentImmediate: input.digitalContentImmediate === true,
    digitalContentRevocationUnderstood: input.digitalContentRevocationUnderstood === true,
    finalContractConfirmed: input.finalContractConfirmed === true,
    answers,
  };
  const missing = [];
  for (const [key, label] of [['customerName', 'Name'], ['street', 'Straße'], ['postalCity', 'PLZ und Ort'], ['customerEmail', 'E-Mail'], ['product', 'Produkt'], ['duration', 'Laufzeit'], ['totalPrice', 'Gesamtpreis'], ['paymentModel', 'Zahlungsmodell'], ['paymentDue', 'Zahlungsplan'], ['place', 'Ort']]) if (!contract[key]) missing.push(label);
  if (!validDate(contract.birthDate)) missing.push('Geburtsdatum');
  if (!validDate(contract.serviceStart)) missing.push('Leistungsbeginn');
  if (!validDate(contract.contractDate)) missing.push('Vertragsdatum');
  return { contract, missing };
}

function pdfText(font, value) {
  return [...String(value || '')].map((character) => {
    try { font.encodeText(character); return character; } catch { return '?'; }
  }).join('');
}

function germanDate(value) {
  if (!validDate(value)) return clean(value, 60);
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function meetingLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value, 60) : date.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
}

function setText(form, font, fieldName, value, { multiline = false, size = 8.5 } = {}) {
  const field = form.getTextField(fieldName);
  if (multiline) field.enableMultiline();
  field.setText(pdfText(font, value));
  field.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
  field.setFontSize(size);
}

function setCheck(form, fieldName, checked) {
  const field = form.getCheckBox(fieldName);
  if (checked) field.check(); else field.uncheck();
}

function removeSignatureField(pdf, form, fieldName) {
  const field = form.getSignature(fieldName);
  const widgets = field.acroField.getWidgets();
  const rectangle = widgets[0]?.getRectangle();
  const widgetRef = widgets[0]?.ref;
  const pageIndex = pdf.getPages().findIndex((page) => widgetRef && page.node.Annots()?.asArray().some((ref) => ref === widgetRef));
  form.acroForm.removeField(field.acroField);
  if (pageIndex >= 0 && widgetRef) pdf.getPages()[pageIndex].node.removeAnnot(widgetRef);
  return { rectangle, pageIndex };
}

export async function buildVideoContractPdf(contract, { videoConfirmed = false, customerSigned = false, providerConfirmed = false } = {}) {
  const templatePath = path.join(process.cwd(), 'assets', 'forms', VIDEO_CONTRACT_TEMPLATE_FILE);
  const pdf = await PDFDocument.load(await readFile(templatePath));
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const textFields = {
    anbieter_email: contract.providerEmail || '—', anbieter_telefon: contract.providerPhone || '—', kunde_name: contract.customerName,
    kunde_geburtsdatum: germanDate(contract.birthDate), kunde_strasse: contract.street, kunde_ort: contract.postalCity,
    kunde_email: contract.customerEmail, kunde_telefon: contract.customerPhone || '—', video_datum_uhrzeit: meetingLabel(contract.meetingAt),
    produkt_paket: contract.product, leistungsbeginn: germanDate(contract.serviceStart), laufzeit: contract.duration,
    gesamtpreis: contract.totalPrice, zahlungsmodell: contract.paymentModel, zahlung_faellig: contract.paymentDue,
    weitere_leistungen: contract.additionalServices || 'Keine zusätzlichen Leistungen vereinbart.', datenschutz_url: contract.privacyUrl || 'Wird mit der Vertragsbestätigung übermittelt.',
    video_abreden: contract.additionalAgreements || 'Keine zusätzlichen individuellen Abreden.', widerruf_email: contract.revocationEmail || contract.providerEmail || '—',
    widerruf_vertragsdatum: germanDate(contract.contractDate), widerruf_name: contract.customerName, widerruf_anschrift: `${contract.street}, ${contract.postalCity}`,
    widerruf_datum: '', widerruf_unterschrift_text: '', abschluss_ort: contract.place, abschluss_datum: germanDate(contract.contractDate),
  };
  for (const [name, value] of Object.entries(textFields)) setText(form, font, name, value, { multiline: ['weitere_leistungen', 'video_abreden'].includes(name), size: ['weitere_leistungen', 'video_abreden'].includes(name) ? 7.5 : 8.5 });
  const serviceChecks = ['leistung_clara', 'leistung_dashboard', 'leistung_material', 'leistung_ki', 'leistung_calls', 'leistung_support'];
  serviceChecks.forEach((name) => setCheck(form, name, true));
  const checks = {
    kunde_verbraucher: contract.consumerConfirmed, vorabinfos_erhalten: contract.priorInformationConfirmed,
    aufnahme_einwilligung: contract.recordingConsent, aufnahme_zweck: contract.recordingPurposeAccepted,
    aufnahme_widerruf: contract.recordingRevocationAccepted, email_richtig: contract.emailConfirmed,
    sofortbeginn_verlangen: contract.immediateStart, dienstleistung_kenntnis: contract.serviceRevocationUnderstood,
    digitalinhalt_sofort: contract.digitalContentImmediate, digitalinhalt_verlust: contract.digitalContentRevocationUnderstood,
    final_vertrag: contract.finalContractConfirmed, final_sofort: contract.immediateStart, final_digital: contract.digitalContentImmediate && contract.digitalContentRevocationUnderstood,
    ...contract.answers,
  };
  for (const [name, checked] of Object.entries(checks)) setCheck(form, name, Boolean(checked && (videoConfirmed || !name.startsWith('v'))));
  form.updateFieldAppearances(font);
  const customerSignature = removeSignatureField(pdf, form, 'kunde_signatur');
  const providerSignature = removeSignatureField(pdf, form, 'anbieter_signatur');
  form.flatten();
  const drawSignature = ({ rectangle, pageIndex }, lines, color) => {
    if (!rectangle || pageIndex < 0) return;
    const page = pdf.getPages()[pageIndex];
    page.drawRectangle({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height, color: rgb(1, 1, 1) });
    lines.forEach((line, index) => page.drawText(pdfText(font, line), { x: rectangle.x + 8, y: rectangle.y + rectangle.height - 14 - index * 12, size: index ? 7.5 : 8.5, font, color, maxWidth: rectangle.width - 16 }));
  };
  if (customerSigned) drawSignature(customerSignature, [`Per digitalem Klick bestätigt von ${contract.customerName}`, `${germanDate(contract.contractDate)} · ${contract.place}`], rgb(.05, .31, .24));
  else if (videoConfirmed) drawSignature(customerSignature, [`Im Video-Abschluss ausdrücklich bestätigt von ${contract.customerName}`, `${germanDate(contract.contractDate)} · zusätzliche digitale Signatur angefordert`], rgb(.15, .28, .34));
  if (providerConfirmed) drawSignature(providerSignature, ['Digital im CRM bestätigt von Markus Becker', `${germanDate(contract.contractDate)} · ${contract.place}`], rgb(.05, .31, .24));
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
