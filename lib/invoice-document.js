const amount = value => Math.round(Number(value) * 100);
const filled = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function invoiceProblems(invoice, { issued = true } = {}) {
 const problems = [], issuer = invoice.issuer || {};
 for (const [value, label] of [[issuer.issuer_name,'Rechnungssteller'],[issuer.issuer_address,'Anschrift des Rechnungsstellers'],[issuer.tax_id,'Steuernummer oder USt-ID'],[invoice.customer_name,'Rechnungsempfänger'],[invoice.customer_address,'Rechnungsanschrift'],[invoice.description,'Leistungsbeschreibung']]) if (!filled(value)) problems.push(label);
 if (!validDate(invoice.service_date)) problems.push('Leistungsdatum');
 if (issued) {
  if (!filled(invoice.invoice_number)) problems.push('Rechnungsnummer');
  if (!validDate(invoice.invoice_date)) problems.push('Rechnungsdatum');
  if (!validDate(invoice.due_date) || invoice.due_date < invoice.invoice_date) problems.push('Fälligkeit');
 }
 const rate = Number(invoice.vat_rate), values = ['net','vat','gross'].map(key=>Number(invoice[key]));
 if (!Number.isFinite(rate) || rate < 0 || rate > 100 || values.some(v=>!Number.isFinite(v)||v<0||Math.abs(v*100-Math.round(v*100))>0.0001) || amount(invoice.net)+amount(invoice.vat)!==amount(invoice.gross) || amount(invoice.net)!==Math.round(amount(invoice.gross)/(1+rate/100))) problems.push('Netto-, Steuer- und Bruttobeträge');
 if (rate === 0 && !filled(issuer.tax_note)) problems.push('Hinweis zum Umsatzsteuersatz 0 %');
 return problems;
}
export const invoiceDate = value => validDate(value) ? value.split('-').reverse().join('.') : '–';
export const invoiceMoney = value => Number(value).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
export function validateInvoice(invoice) {
 const problems=invoiceProblems(invoice);
 if(problems.length) throw Object.assign(new Error('Rechnung unvollständig oder widersprüchlich: '+problems.join(', ')+'.'),{status:409});
 return invoice;
}
