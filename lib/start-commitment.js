import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { storeGeneratedParticipantDocument } from './generated-document-storage.js';
import { serviceHeaders } from './program-access-service.js';

export const START_COMMITMENT_TEMPLATE_FILE = 'FDD-FRM-001_Mein-persoenliches-Commitment_V1.2.pdf';
export const START_COMMITMENT_TEMPLATE_URL = `/assets/forms/${START_COMMITMENT_TEMPLATE_FILE}`;

const clean = (value, max = 600) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
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

function formatGermanDate(value) {
  const [year, month, day] = String(value).split('-');
  return `${day}.${month}.${year}`;
}

export function normalizeStartCommitment(input = {}, profile = {}, programStartDate = '') {
  const commitment = {
    name: clean(input.name || profile.name, 160),
    startDate: normalizedDate(input.startDate || input.start_date || programStartDate),
    why: clean(input.why || input.reason, 600),
    change: clean(input.change || input.desiredChange, 600),
    costOfUnclarity: clean(input.costOfUnclarity || input.cost_of_unclarity || input.cost, 600),
    place: clean(input.place || profile.city, 120),
    signatureDate: normalizedDate(input.signatureDate || input.signature_date || input.date),
    accepted: checked(input.accepted ?? input.commitmentAccepted ?? input.confirmed),
  };
  const missing = [];
  if (!commitment.name) missing.push('Vor- und Nachname');
  if (!validDate(commitment.startDate)) missing.push('gültiges Startdatum');
  if (!commitment.why) missing.push('warum du hier bist');
  if (!commitment.change) missing.push('was du für dich verändern möchtest');
  if (!commitment.costOfUnclarity) missing.push('was weitere Unklarheit dich kostet');
  if (!commitment.place) missing.push('Ort');
  if (!validDate(commitment.signatureDate)) missing.push('gültiges Bestätigungsdatum');
  if (!commitment.accepted) missing.push('verbindliche Klickbestätigung');
  return { commitment, missing };
}

function fillTextField(form, name, value, { multiline = false, size = 10 } = {}) {
  const field = form.getTextField(name);
  if (multiline) field.enableMultiline();
  field.setText(value);
  field.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
  field.setFontSize(size);
}

function supportedPdfText(font, value) {
  return [...String(value || '')].map((character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return '?';
    }
  }).join('');
}

export async function buildCompletedStartCommitmentPdf(commitment) {
  const templatePath = path.join(process.cwd(), 'assets', 'forms', START_COMMITMENT_TEMPLATE_FILE);
  const pdf = await PDFDocument.load(await readFile(templatePath));
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pdfText = (value) => supportedPdfText(font, value);
  fillTextField(form, 'name', pdfText(commitment.name));
  fillTextField(form, 'startdatum', formatGermanDate(commitment.startDate));
  fillTextField(form, 'warum_ich_hier_bin', pdfText(commitment.why), { multiline: true, size: 9 });
  fillTextField(form, 'veraenderung', pdfText(commitment.change), { multiline: true, size: 9 });
  fillTextField(form, 'kosten_unklarheit', pdfText(commitment.costOfUnclarity), { multiline: true, size: 9 });
  fillTextField(form, 'ort_und_datum', pdfText(`${commitment.place}, ${formatGermanDate(commitment.signatureDate)}`));

  form.updateFieldAppearances(font);
  const signature = form.getSignature('unterschrift');
  const widget = signature.acroField.getWidgets()[0];
  const rectangle = widget?.getRectangle();
  form.acroForm.removeField(signature.acroField);
  if (widget?.ref) pdf.getPages()[1].node.removeAnnot(widget.ref);
  form.flatten();
  if (rectangle) {
    const page = pdf.getPages()[1];
    page.drawRectangle({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height, color: rgb(1, 1, 1) });
    page.drawText(pdfText(`Per digitalem Klick bestätigt von ${commitment.name}`), {
      x: rectangle.x + 8,
      y: rectangle.y + 21,
      size: 9,
      font,
      color: rgb(0.08, 0.20, 0.18),
      maxWidth: rectangle.width - 16,
    });
    page.drawText(pdfText(`am ${formatGermanDate(commitment.signatureDate)} in ${commitment.place}`), {
      x: rectangle.x + 8,
      y: rectangle.y + 8,
      size: 8,
      font,
      color: rgb(0.24, 0.34, 0.31),
      maxWidth: rectangle.width - 16,
    });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export async function readStartCommitmentDocument(service, participantId) {
  const response = await fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.0&document_type=eq.start_commitment&select=id,week,document_type,display_title,original_file_name,storage_path,source,visibility,processing_status,participant_confirmed_at,extracted_data,created_at&order=created_at.desc&limit=1`, { headers: serviceHeaders(service.key) });
  const data = await response.json().catch(() => ([]));
  if (!response.ok && (response.status === 404 || ['PGRST205', '42P01'].includes(data?.code))) return null;
  if (!response.ok) throw new Error(data.message || 'Persönliches Commitment konnte nicht geladen werden.');
  return data[0] || null;
}

export async function storeStartCommitmentDocument(service, participantId, commitment, confirmedAt = new Date().toISOString()) {
  const buffer = await buildCompletedStartCommitmentPdf(commitment);
  const safeName = commitment.name.replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, '-');
  const fileName = `FDD-Mein-persoenliches-Commitment-${safeName}.pdf`;
  return storeGeneratedParticipantDocument({
    service, participantId, buffer, fileName, documentType: 'start_commitment', title: 'Mein persönliches Commitment',
    extractedData: { artifactType: 'start_commitment', commitment, signatureMethod: 'digital_click_confirmation', confirmedAt },
    extractionVersion: 'start-commitment-v1.2', confirmedAt,
  });
}
