import test from 'node:test';import assert from 'node:assert/strict';
import {customerAccount} from '../lib/customer-account.js';import {financeReport,invoiceBalances} from '../lib/finance.js';import {accountPdf} from '../lib/customer-account-pdf.js';import {PDFDocument} from 'pdf-lib';import {PDFParse} from 'pdf-parse';
const i={id:'i',status:'issued',lead_id:'l',invoice_number:'FDD-RE-1',invoice_date:'2026-08-01',due_date:'2026-09-01',gross:119,net:100,vat:19,vat_rate:19,customer_name:'Testkunde',customer_address:'Teststraße 1\n12345 Berlin',description:'Persönliche Begleitung',service_date:'2026-08-01',issuer:{issuer_name:'Markus Becker',issuer_address:'Teststraße 1',tax_id:'Test'}};
const p={id:'p',lead_id:'l',invoice_id:'i',status:'booked',amount:19,booked_at:'2026-09-01'};
const e={id:'e',lead_id:'l',invoice_id:'i',kind:'credit',document_number:'FDD-GS-1',booked_at:'2026-09-02',created_at:'2026-09-02T12:00:00Z',amount:23.80,net:20,vat:3.8,reason:'Preisnachlass'};
const today='2026-09-21';
test('account ledger, OPOS and period revenue share credit and payment arithmetic without counting writeoffs as revenue or cash',()=>{
 const writeoff={...e,id:'w',kind:'writeoff',amount:76.2,net:0,vat:0};
 let a=customerAccount({invoices:[i],payments:[p],events:[e],today});assert.equal(a.summary.balance,76.2);assert.equal(a.summary.open,76.2);assert.equal(a.entries.at(-1).balance,76.2);
 a=customerAccount({invoices:[i],payments:[p],events:[e,writeoff],today});assert.equal(a.summary.balance,0);assert.equal(a.summary.open,0);assert.equal(a.summary.payments,19);assert.equal(a.invoices[0].payment_status,'written_off');
 const r=financeReport([i],[p],{year:2026,month:9,today,events:[e,writeoff]});assert.equal(r.gross,-23.8);assert.equal(r.net,-20);assert.equal(r.vat,-3.8);assert.equal(r.payments,19);assert.equal(r.writeoffs.length,1);assert.equal(r.credits[0].source_invoice_number,'FDD-RE-1');
});
test('historical cutoff excludes future credits/payments and restores the original due date',()=>{
 const due={...e,id:'d',kind:'due',amount:0,due_date:'2026-10-01'};
 assert.equal(invoiceBalances([i],[p],'2026-08-31',[e,due])[0].open,119);
 assert.equal(invoiceBalances([i],[p],'2026-08-31',[e,due])[0].due_date,'2026-09-01');
 const a=customerAccount({invoices:[i],payments:[p],events:[e,due],today});assert.equal(a.summary.future,76.2);assert.equal(a.summary.due,0);assert.equal(a.summary.balance,76.2);
});
test('unallocated payments and credits on paid invoices remain visible as customer credit without hiding unrelated OPOS',()=>{
 const extra={...i,id:'j',gross:50};const a=customerAccount({invoices:[i,extra],payments:[{...p,amount:119},{...p,id:'u',invoice_id:null,amount:10}],events:[e],today});
 assert.equal(a.summary.balance,16.2);assert.equal(a.summary.open,50);assert.equal(a.summary.customerCredit,33.8);assert.equal(a.summary.unallocated,10);assert.equal(a.entries.filter(e=>e.status==='unassigned').length,1);
});
test('pending and cancelled payments are listed without changing money; drafts never create a receivable',()=>{
 const a=customerAccount({invoices:[i,{...i,id:'draft',status:'needs_details'}],payments:[{...p,status:'pending'},{...p,id:'cancelled',status:'cancelled'}],today});assert.equal(a.summary.balance,119);assert.equal(a.summary.payments,0);assert.equal(a.entries.length,3);assert.equal(a.pendingInvoices,1);
});
test('branded landscape account PDF includes every entry, running balance and multipage headers; credit document includes invoice and VAT',async()=>{
 const invoices=Array.from({length:65},(_,n)=>({...i,id:'i'+n,invoice_number:'FDD-RE-'+n,description:'Buchung '+n}));const account={...customerAccount({invoices,payments:[],events:[],today}),profile:{name:'PDF Testkunde',customer_number:'FDD-123'}};
 const bytes=await accountPdf(account),doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>1);assert.ok(doc.getPage(0).getWidth()>doc.getPage(0).getHeight());
 let parser=new PDFParse({data:bytes});try{const {text}=await parser.getText();for(let n=0;n<65;n++)assert.ok(text.includes('FDD-RE-'+n));assert.match(text,/Schlusssaldo/);assert.match(text,/7\.735,00/);}finally{await parser.destroy();}
 parser=new PDFParse({data:await accountPdf(account,{event:e,invoice:i})});try{const {text}=await parser.getText();assert.match(text,/FDD-GS-1/);assert.match(text,/FDD-RE-1/);assert.match(text,/19 %/);assert.match(text,/23,80/);assert.match(text,/Testkunde/);}finally{await parser.destroy();}
});
