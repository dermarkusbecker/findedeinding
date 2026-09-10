import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { storeGeneratedParticipantDocument } from './generated-document-storage.js';
import { serviceHeaders } from './program-access-service.js';

export const PRIVACY_TEMPLATE_FILE = 'FDD-FRM-002_Datenschutzinformation-und-Einwilligung_Finde-Dein-Ding_V1.0.pdf';
export const PRIVACY_TEMPLATE_URL = `/assets/forms/${PRIVACY_TEMPLATE_FILE}`;

const clean = (value, max = 240) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
const checked = (value) => value === true || value === 1 || ['true', '1', 'on', 'yes', 'ja'].includes(String(value || '').trim().toLowerCase());
function normalizedDate(value) {
  const raw = clean(value, 10);
  if (validDate(raw)) return raw;
  const german = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!german) return raw;
  const iso = `${german[3]}-${german[2]}-${german[1]}`;
  return validDate(iso) ? iso : raw;
}

export function normalizePrivacyConsent(input = {}, profile = {}) {
  const consent = {
    specialCategories: checked(input.specialCategories ?? input.special_categories ?? input.sensitiveDataAccepted),
    privacyNotice: checked(input.privacyNotice ?? input.privacy_notice ?? input.privacyAccepted),
    aiNotice: checked(input.aiNotice ?? input.ai_notice ?? input.aiAccepted),
    name: clean(input.name || profile.name, 160),
    email: clean(profile.email, 240),
    place: clean(input.place || profile.city, 120),
    date: normalizedDate(input.date),
  };
  const missing = [];
  if (!consent.specialCategories) missing.push('Einwilligung zu freiwillig angegebenen sensiblen Daten');
  if (!consent.privacyNotice) missing.push('Kenntnisnahme der Datenschutzinformation');
  if (!consent.aiNotice) missing.push('Kenntnisnahme der KI-gestützten Verarbeitung');
  if (!consent.name) missing.push('Vor- und Nachname');
  if (!consent.place) missing.push('Ort');
  if (!validDate(consent.date)) missing.push('gültiges Datum');
  return { consent, missing };
}

export function normalizeOnboardingProfile(input = {}, current = {}) {
  const profile = {
    name: clean(input.name || current.name, 160),
    birth_date: validDate(input.birthDate || current.birth_date) ? (input.birthDate || current.birth_date) : null,
    street: clean(input.street ?? current.street, 180) || null,
    postal_code: clean(input.postalCode ?? current.postal_code, 20) || null,
    city: clean(input.city ?? current.city, 120) || null,
    country: clean(input.country ?? current.country, 120) || null,
    phone: clean(input.phone ?? current.phone, 40) || null,
    mobile_phone: clean(input.mobilePhone ?? current.mobile_phone, 40) || null,
    whatsapp_same_as_mobile: input.whatsappSameAsMobile !== false,
    whatsapp_phone: clean(input.whatsappSameAsMobile !== false ? (input.mobilePhone ?? current.mobile_phone) : (input.whatsappPhone ?? current.whatsapp_phone), 40) || null,
    preferred_communication_channel: ['email', 'phone', 'whatsapp'].includes(input.preferredChannel) ? input.preferredChannel : (current.preferred_communication_channel || 'email'),
  };
  return { profile, missing: missingOnboardingFields(profile, current.email) };
}

export function missingOnboardingFields(profile = {}, email = profile.email) {
  const requirements = [
    ['name', 'Vor- und Nachname'],
    ['birth_date', 'Geburtsdatum'],
    ['street', 'Straße und Hausnummer'],
    ['postal_code', 'Postleitzahl'],
    ['city', 'Ort'],
    ['country', 'Land'],
  ];
  const missing = requirements.filter(([key]) => !clean(profile[key], 240)).map(([, label]) => label);
  if (!clean(email, 240)) missing.push('E-Mail-Adresse');
  if (!clean(profile.mobile_phone || profile.phone, 40)) missing.push('Telefon- oder Mobilnummer');
  return missing;
}

function formatGermanDate(value) {
  const [year, month, day] = String(value).split('-');
  return `${day}.${month}.${year}`;
}

function removeSignatureWidget(pdf, form, fieldName) {
  const signature = form.getSignature(fieldName);
  const widget = signature.acroField.getWidgets()[0];
  const rectangle = widget?.getRectangle();
  const widgetRef = widget?.ref;
  const pageIndex = pdf.getPages().findIndex((page) => widgetRef && page.node.Annots()?.asArray().some((reference) => reference === widgetRef));
  form.acroForm.removeField(signature.acroField);
  if (widgetRef) pdf.getPages()[pageIndex >= 0 ? pageIndex : 1]?.node.removeAnnot(widgetRef);
  return { rectangle, pageIndex: pageIndex >= 0 ? pageIndex : 1 };
}

export async function buildReadonlyPrivacyPreviewPdf() {
  const templatePath = path.join(process.cwd(), 'assets', 'forms', PRIVACY_TEMPLATE_FILE);
  const pdf = await PDFDocument.load(await readFile(templatePath));
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  removeSignatureWidget(pdf, form, 'unterschrift_teilnehmer');
  form.updateFieldAppearances(font);
  form.flatten();
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

async function buildFilledPrivacyPdf(consent = {}, finalized = false) {
  const templatePath = path.join(process.cwd(), 'assets', 'forms', PRIVACY_TEMPLATE_FILE);
  const pdf = await PDFDocument.load(await readFile(templatePath));
  const form = pdf.getForm();
  const checkValues = {
    einwilligung_besondere_daten: consent.specialCategories === true,
    kenntnisnahme_datenschutz: consent.privacyNotice === true,
    kenntnisnahme_ki: consent.aiNotice === true,
  };
  Object.entries(checkValues).forEach(([fieldName, checked]) => {
    const field = form.getCheckBox(fieldName);
    if (checked) field.check();
    else field.uncheck();
  });
  const textValues = {
    kunde_name: consent.name || '',
    kunde_email: consent.email || '',
    ort: consent.place || '',
    datum: validDate(consent.date) ? formatGermanDate(consent.date) : '',
  };
  Object.entries(textValues).forEach(([fieldName, value]) => {
    const field = form.getTextField(fieldName);
    field.setText(value);
    field.acroField.setDefaultAppearance('/Helv 10 Tf 0 g');
  });

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  const signature = removeSignatureWidget(pdf, form, 'unterschrift_teilnehmer');
  form.flatten();
  if (signature.rectangle) {
    const page = pdf.getPages()[signature.pageIndex];
    page.drawRectangle({ x: signature.rectangle.x, y: signature.rectangle.y, width: signature.rectangle.width, height: signature.rectangle.height, color: rgb(1, 1, 1) });
    const previewDetails = [consent.name, validDate(consent.date) ? formatGermanDate(consent.date) : '', consent.place].filter(Boolean).join(' · ');
    const signatureText = finalized
      ? `Per digitalem Klick bestätigt am ${formatGermanDate(consent.date)} in ${consent.place}`
      : `Vorschau – noch nicht verbindlich bestätigt${previewDetails ? ` · ${previewDetails}` : ''}`;
    page.drawText(signatureText, { x: signature.rectangle.x + 7, y: signature.rectangle.y + 9, size: 8.6, font, color: rgb(0.08, 0.20, 0.27), maxWidth: signature.rectangle.width - 14 });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export async function buildDraftPrivacyPreviewPdf(consent) {
  return buildFilledPrivacyPdf(consent, false);
}

export async function buildCompletedPrivacyPdf(consent) {
  return buildFilledPrivacyPdf(consent, true);
}

export async function readPrivacyConsentDocument(service, participantId) {
  const response = await fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.0&document_type=in.(privacy_consent,other)&select=id,week,document_type,display_title,original_file_name,storage_path,source,visibility,processing_status,participant_confirmed_at,extracted_data,created_at&order=created_at.desc&limit=50`, { headers: serviceHeaders(service.key) });
  const data = await response.json().catch(() => ([]));
  if (!response.ok && (response.status === 404 || ['PGRST205', '42P01'].includes(data?.code))) return null;
  if (!response.ok) throw new Error(data.message || 'Datenschutzeinwilligung konnte nicht geladen werden.');
  return data.find((document) => document.document_type === 'privacy_consent' || document.extracted_data?.artifactType === 'privacy_consent') || null;
}

export async function storePrivacyConsentDocument(service, participantId, consent, confirmedAt = new Date().toISOString()) {
  const buffer = await buildCompletedPrivacyPdf(consent);
  const fileName = `FDD-Datenschutzeinwilligung-${consent.name.replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, '-')}.pdf`;
  return storeGeneratedParticipantDocument({
    service, participantId, buffer, fileName, documentType: 'privacy_consent', fallbackDocumentType: 'other',
    title: 'Datenschutzinformation & Einwilligung',
    extractedData: { artifactType: 'privacy_consent', consent, signatureMethod: 'digital_click_confirmation', confirmedAt },
    extractionVersion: 'privacy-consent-v1', confirmedAt,
  });
}
