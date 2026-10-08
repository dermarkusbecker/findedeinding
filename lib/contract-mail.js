import { readCustomerObject } from './customer-storage.js';
import { archivedInvoiceDocument } from './invoice-archive.js';
import { mailAppearance, sendPreparedMail } from './branded-mail-service.js';
import { renderBrandedEmail } from './branded-email.js';

const headers = service => ({ apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json' });
async function rows(service, path, options = {}) {
  const response = await fetch(`${service.url}/rest/v1/${path}`, { ...options, headers: { ...headers(service), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error(data.message || 'Vertrags-E-Mail konnte nicht vorbereitet werden.');
  return data;
}
const replace = (value, tokens) => String(value || '').replace(/{{([a-z_]+)}}/gi, (_, key) => String(tokens[key] ?? ''));

async function sendOne(service, { lead, contract, invoice, templateKey, eventKey, pdf, filename, bucket, storagePath, tokens, actor }) {
  const existing = (await rows(service, `lead_communications?event_key=eq.${encodeURIComponent(eventKey)}&select=*&limit=1`))[0];
  if (existing?.delivery_status === 'accepted') return { status: 'already_accepted' };
  if (existing && !['draft', 'failed'].includes(existing.delivery_status)) return { status: 'check_mailbox' };
  const template = (await rows(service, `communication_templates?template_key=eq.${encodeURIComponent(templateKey)}&status=eq.active&select=*&limit=1`))[0];
  if (!template) throw new Error(`Aktive E-Mail-Vorlage ${templateKey} fehlt.`);
  const subject = replace(template.subject, tokens), body = replace(template.body, tokens);
  const appearance = await mailAppearance(service);
  const rendered = renderBrandedEmail({ subject, body, ...appearance });
  const recipient = contract.contract_data?.customerEmail || lead.email;
  if (!/^\S+@\S+\.\S+$/.test(recipient || '')) throw new Error('Empfängeradresse für den Vertragsversand fehlt.');
  let record = existing;
  if (!record) record = (await rows(service, 'lead_communications', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ lead_id: lead.id, user_profile_id: lead.converted_user_profile_id || null, channel: 'email', direction: 'outbound', subject, body: rendered.text, body_html: rendered.html, preview: filename ? `${filename} · Automatischer Vertragsversand` : 'Willkommen bei Finde dein Ding · Automatischer Versand', recipient_email: recipient, delivery_status: 'draft', signature_id: appearance.signature?.id || null, sent_by_name: actor || 'CRM', attachments: filename ? [{ fileName: filename, mimeType: 'application/pdf', bucket, storagePath, contractId: contract.id, invoiceId: invoice?.id || null }] : [], automation_source: 'contract_signed', event_key: eventKey }) }))[0];
  const reserved = await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.${record.delivery_status}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ delivery_status: 'pending', updated_at: new Date().toISOString() }) });
  if (!reserved[0]) return { status: 'check_mailbox' };
  try {
    const sent = await sendPreparedMail({ to: recipient, subject: record.subject, text: record.body, html: record.body_html, attachments: filename ? [{ filename, content: pdf, contentType: 'application/pdf' }] : [] });
    await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: 'accepted', provider_message_id: sent.providerMessageId, sender_email: sent.senderEmail, occurred_at: new Date().toISOString(), updated_at: new Date().toISOString(), preview: `${filename || 'Willkommens-E-Mail'} · Von STRATO angenommen; Zustellung nicht bestätigt.` }) });
    return { status: 'accepted' };
  } catch (error) {
    const certain = ['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error.code) || [400, 503].includes(error.status);
    await rows(service, `lead_communications?id=eq.${record.id}&delivery_status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ delivery_status: certain ? 'failed' : 'unknown', preview: certain ? 'STRATO-Versand fehlgeschlagen.' : 'Versandstatus unklar: STRATO-Postfach vor einem erneuten Versuch prüfen.', updated_at: new Date().toISOString() }) }).catch(() => null);
    throw error;
  }
}

export async function sendSignedContractMail(service, { leadId, contractId, actor }) {
  const [lead] = await rows(service, `leads?id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
  const [contract] = await rows(service, `lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}&status=eq.signed&select=*&limit=1`);
  if (!lead || !contract || contract.archived_at) throw new Error('Unterschriebener Vertrag wurde nicht gefunden.');
  const [invoice] = await rows(service, `finance_invoices?contract_id=eq.${encodeURIComponent(contract.id)}&status=eq.issued&select=*&limit=1`);
  if (!invoice) throw new Error('Die ausgestellte Rechnung fehlt; E-Mails wurden nicht versendet.');
  if (!contract.document_bucket || !contract.document_storage_path) throw new Error('Das unterschriebene Vertrags-PDF fehlt. Der Versand wurde nicht gestartet.');
  const contractPdf = await readCustomerObject(service, contract.document_bucket, contract.document_storage_path);
  const invoicePdf = await archivedInvoiceDocument({ config: service, headers: headers(service), invoice });
  const tokens = { vorname: String(lead.name || '').split(' ')[0], vertragsnummer: contract.contract_number || contract.id, rechnungsnummer: invoice.invoice_number, tarif: contract.contract_data?.tariffName || contract.title, laufzeit: contract.contract_data?.duration || 'gemäß Vertrag', preis: `${Number(contract.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`, zahlungsmodell: contract.contract_data?.paymentModel || 'gemäß Rechnung', faellig: contract.contract_data?.paymentDue || `Fällig am ${invoice.due_date || 'gemäß Rechnung'}`, zusatzabreden: contract.contract_data?.additionalAgreements || 'Keine.' };
  const first = await sendOne(service, { lead, contract, invoice, templateKey: 'contract_signed_document', eventKey: `contract-signed-document:${contract.id}`, pdf: contractPdf, filename: `${contract.contract_number || 'Vertrag'}.pdf`, bucket: contract.document_bucket, storagePath: contract.document_storage_path, tokens, actor });
  if (!['accepted', 'already_accepted'].includes(first.status)) return { contract: first.status, invoice: 'waiting' };
  const second = await sendOne(service, { lead, contract, invoice, templateKey: 'contract_signed_invoice', eventKey: `contract-signed-invoice:${contract.id}`, pdf: invoicePdf, filename: `${invoice.invoice_number}.pdf`, bucket: 'finance-documents', storagePath: `invoices/${invoice.id}.design-v2.pdf`, tokens, actor });
  if (!['accepted', 'already_accepted'].includes(second.status)) return { contract: first.status, invoice: second.status, welcome: 'waiting' };
  const welcome = await sendOne(service, { lead, contract, invoice, templateKey: 'contract_completed', eventKey: `contract-welcome:${contract.id}`, tokens, actor });
  return { contract: first.status, invoice: second.status, welcome: welcome.status };
}
