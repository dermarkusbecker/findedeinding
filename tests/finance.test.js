import test from 'node:test';import assert from 'node:assert/strict';
import {invoiceBalances,financeReport} from '../lib/finance.js';import {financePdf} from '../lib/finance-pdf.js';import {PDFDocument} from 'pdf-lib';
const invoices=[{id:'a',status:'issued',invoice_date:'2026-01-10',due_date:'2026-01-10',net:100,vat:19,gross:119},{id:'b',status:'issued',invoice_date:'2026-02-10',due_date:'2026-02-10',net:200,vat:38,gross:238},{id:'c',status:'needs_details',gross:999}];
const payments=[{invoice_id:'a',status:'booked',amount:19,booked_at:'2026-02-11'},{invoice_id:'b',status:'pending',amount:238,booked_at:'2026-02-11'},{invoice_id:'a',status:'booked',amount:100,booked_at:'2026-03-01'}];
test('invoice and payment months remain separate, partial payments do not close OPOS',()=>{const rows=invoiceBalances(invoices,payments,'2026-02-28');assert.equal(rows[0].open,100);assert.equal(rows[0].payment_status,'partial');assert.equal(rows[1].open,238);const r=financeReport(invoices,payments,{year:2026,month:2,today:'2026-02-28'});assert.equal(r.gross,238);assert.equal(r.payments,19);assert.equal(r.net+r.vat,r.gross);});
test('year-to-date includes empty months but no future payments or draft invoices',()=>{const r=financeReport(invoices,payments,{year:2026,today:'2026-04-12'});assert.equal(r.months.length,4);assert.equal(r.months[3].gross,0);assert.equal(r.gross,357);assert.equal(r.payments,119);assert.equal(r.to,'2026-04-12');assert.throws(()=>financeReport(invoices,payments,{year:2027,today:'2026-04-12'}));});
test('report PDF is landscape and paginates detailed customer rows',async()=>{const report=financeReport(invoices,payments,{year:2026,today:'2026-04-12'});report.invoices=Array.from({length:70},(_,n)=>({...invoices[0],invoice_number:'RE-'+n,customer_name:'Kunde '+n,description:'Programm',contract_id:'Vertrag',vat_rate:19}));const doc=await PDFDocument.load(await financePdf({report,details:true}));assert.ok(doc.getPageCount()>1);assert.ok(doc.getPage(0).getWidth()>doc.getPage(0).getHeight());});

test('advisor report preserves tax groups and payment balances at the report cutoff',()=>{
 const rows=[{...invoices[0],vat_rate:19},{...invoices[1],invoice_date:'2026-01-20',vat_rate:7,net:100,vat:7,gross:107}];
 const r=financeReport(rows,[{invoice_id:'a',status:'booked',amount:19,booked_at:'2026-01-31'},{invoice_id:'a',status:'booked',amount:100,booked_at:'2026-02-01'}],{year:2026,month:1,today:'2026-09-21'});
 assert.deepEqual(r.rates,[{rate:7,net:100,vat:7,gross:107},{rate:19,net:100,vat:19,gross:119}]);
 assert.equal(r.paid,19);assert.equal(r.open,207);assert.equal(r.invoices[0].open,100);assert.equal(r.invoiceCount,2);
});
test('compact monthly PDF fits one branded page and detail export keeps ordinary rows together',async()=>{
 const {PDFParse}=await import('pdf-parse');
 const rows=Array.from({length:8},(_,n)=>({...invoices[0],id:String(n),vat_rate:19,invoice_number:`FDD-RE-2026-${n+1}`,customer_name:`Testkunde ${n+1}`,customer_address:'Musterstraße 12\n74177 Bad Friedrichshall\nDeutschland',contract:{contract_number:`FDD-2026-${n+1}`},description:'Persönliche Begleitung im 8-Wochen-Programm',service_date:'2026-01-14'}));
 const report=financeReport(rows,[],{year:2026,month:1,today:'2026-09-21'});
 const compact=await financePdf({report});assert.equal((await PDFDocument.load(compact)).getPageCount(),1);
 const parser=new PDFParse({data:await financePdf({report,details:true})});
 try{const parsed=await parser.getText();assert.match(parsed.text,/STEUERBERATERPORTAL/);assert.match(parsed.text,/19 %/);for(let n=1;n<=8;n++){const pages=parsed.pages.filter(p=>p.text.includes(`Testkunde ${n}`));assert.equal(pages.length,1);assert.ok(pages[0].text.includes(`FDD-RE-2026-${n}`));assert.ok(pages[0].text.includes(`FDD-2026-${n}`));assert.ok(pages[0].text.includes('Leistung ab 14.01.2026'));}}finally{await parser.destroy();}
});
