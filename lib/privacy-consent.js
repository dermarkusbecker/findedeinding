import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { deleteCustomerObject, uploadCustomerObject } from './customer-storage.js';
import { serviceHeaders } from './program-access-service.js';

export const PRIVACY_TEMPLATE_FILE = 'FDD-FRM-002_Datenschutzinformation-und-Einwilligung_Finde-Dein-Ding_V1.0.pdf';
export const PRIVACY_TEMPLATE_URL = `/assets/forms/${PRIVACY_TEMPLATE_FILE}`;

const clean = (value, max = 240) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export function normalizePrivacyConsent(input = {}, profile = {}) {
  const consent = {
    specialCategories: input.specialCategories === true,
    privacyNotice: input.privacyNotice === true,
    aiNotice: input.aiNotice === true,
    name: clean(input.name || profile.name, 160),
    email: clean(profile.email, 240),
    place: clean(input.place || profile.city, 120),
    date: clean(input.date, 10),
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

export async function buildCompletedPrivacyPdf(consent) {
  const templatePath = path.join(process.cwd(), 'assets', 'forms', PRIVACY_TEMPLATE_FILE);
  const pdf = await PDFDocument.load(await readFile(templatePath));
  const form = pdf.getForm();
  form.getCheckBox('einwilligung_besondere_daten').check();
  form.getCheckBox('kenntnisnahme_datenschutz').check();
  form.getCheckBox('kenntnisnahme_ki').check();
  const textValues = {
    kunde_name: consent.name,
    kunde_email: consent.email || '—',
    ort: consent.place,
    datum: formatGermanDate(consent.date),
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
    const signatureText = `Per digitalem Klick bestätigt am ${formatGermanDate(consent.date)} in ${consent.place}`;
    page.drawText(signatureText, { x: signature.rectangle.x + 7, y: signature.rectangle.y + 9, size: 8.6, font, color: rgb(0.08, 0.20, 0.27), maxWidth: signature.rectangle.width - 14 });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

async function responseRows(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || fallback), { status: response.status });
  return data;
}

export async function readPrivacyConsentDocument(service, participantId) {
  const response = await fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.0&document_type=in.(privacy_consent,other)&select=id,document_type,participant_confirmed_at,extracted_data,created_at&order=created_at.desc&limit=50`, { headers: serviceHeaders(service.key) });
  const data = await response.json().catch(() => ([]));
  if (!response.ok && (response.status === 404 || ['PGRST205', '42P01'].includes(data?.code))) return null;
  if (!response.ok) throw new Error(data.message || 'Datenschutzeinwilligung konnte nicht geladen werden.');
  return data.find((document) => document.document_type === 'privacy_consent' || document.extracted_data?.artifactType === 'privacy_consent') || null;
}

export async function storePrivacyConsentDocument(service, participantId, consent, confirmedAt = new Date().toISOString()) {
  const buffer = await buildCompletedPrivacyPdf(consent);
  const fileName = `FDD-Datenschutzeinwilligung-${consent.name.replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, '-')}.pdf`;
  const upload = { buffer, fileName, mimeType: 'application/pdf', sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  const stored = await uploadCustomerObject(service, 'documents', participantId, upload);
  const documentPayload = {
    user_profile_id: participantId,
    week: 0,
    document_type: 'privacy_consent',
    display_title: 'Datenschutzinformation & Einwilligung',
    original_file_name: fileName,
    mime_type: 'application/pdf',
    byte_size: buffer.length,
    storage_bucket: stored.bucket,
    storage_path: stored.storagePath,
    sha256: upload.sha256,
    processing_status: 'ready',
    extraction_method: 'pdf_form_fill',
    extracted_data: { artifactType: 'privacy_consent', consent, signatureMethod: 'digital_click_confirmation', confirmedAt },
    extraction_version: 'privacy-consent-v1',
    participant_confirmed_at: confirmedAt,
    source: 'system',
    visibility: 'customer',
    uploaded_by_profile_id: participantId,
  };
  const insertDocument = async (payload) => responseRows(await fetch(`${service.url}/rest/v1/participant_documents`, {
      method: 'POST',
      headers: serviceHeaders(service.key, { Prefer: 'return=representation' }),
      body: JSON.stringify(payload),
    }), 'Die ausgefüllte Datenschutzeinwilligung konnte nicht in Dokumente abgelegt werden.');
  try {
    let rows;
    try { rows = await insertDocument(documentPayload); }
    catch (error) {
      if (!/document_type|check constraint|privacy_consent/i.test(error.message)) throw error;
      rows = await insertDocument({ ...documentPayload, document_type: 'other' });
    }
    return rows[0];
  } catch (error) {
    await deleteCustomerObject(service, stored.bucket, stored.storagePath);
    throw error;
  }
}
