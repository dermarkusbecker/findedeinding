import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {PDFParse} from 'pdf-parse';
import {financePdf} from '../lib/finance-pdf.js';
import {invoiceProblems} from '../lib/invoice-document.js';
import {archivedInvoiceDocument} from '../lib/invoice-archive.js';
const invoice={id:'00000000-0000-4000-8000-000000000001',invoice_number:'FDD-RE-2026-000123',invoice_date:'2026-09-21',due_date:'2026-09-21',service_date:'2026-10-01',description:'Persönliche Begleitung im 8-Wochen-Programm',customer_name:'Jana Müller',customer_address:'Musterstraße 12\n10115 Berlin\nDeutschland',issuer:{issuer_name:'Markus Becker',issuer_address:'Amorbacher Str. 39\n74177 Bad Friedrichshall\nDeutschland',tax_id:'DE311109135',iban:'DE89 3704 0044 0532 0130 00',account_holder:'Markus Becker',email:'markus@example.test',website:'findedeinding.de'},document_details:{customer_number:'FDD-2026-00123',contract_number:'FDD-V-2026-00123',duration:'8 Wochen',product:'Klarheit. Richtung. Umsetzung.'},net:2405.88,vat:457.12,gross:2863,vat_rate:19};
const extract=async bytes=>{const parser=new PDFParse({data:bytes});try{return await parser.getText();}finally{await parser.destroy();}};
test('invoice validation blocks missing essentials, inconsistent tax and invalid dates',()=>{
 assert.deepEqual(invoiceProblems(invoice),[]);
 for(const field of ['invoice_number','invoice_date','due_date','service_date','customer_name','customer_address','description'])assert.ok(invoiceProblems({...invoice,[field]:''}).length,field);
 assert.ok(invoiceProblems({...invoice,net:2405.87,vat:457.13}).length);
 assert.ok(invoiceProblems({...invoice,service_date:'2026-02-30'}).length);
 assert.ok(invoiceProblems({...invoice,issuer:{...invoice.issuer,tax_id:''}}).length);
 assert.ok(invoiceProblems({...invoice,net:2863,vat:0,vat_rate:0}).includes('Hinweis zum Umsatzsteuersatz 0 %'));
});
test('branded invoice fits one A4 page, retains legal data and searchable umlauts',async()=>{
 const bytes=await financePdf({invoice}),pdf=await PDFDocument.load(bytes),parsed=await extract(bytes);
 assert.equal(pdf.getPageCount(),1);assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<1);
 for(const value of ['Rechnung','Jana Müller','Musterstraße 12','FDD-RE-2026-000123','21.09.2026','01.10.2026','DE311109135','8 Wochen','2.405,88','457,12','2.863,00','sofort ohne Abzug','Verwendungszweck','Seite 1 von 1'])assert.ok(parsed.text.includes(value),value);
 await import('node:fs/promises').then(fs=>fs.writeFile('/tmp/fdd-rechnung-muster.pdf',bytes));
});
test('long descriptions paginate with repeated table headers and no lost words',async()=>{
 const description=Array.from({length:200},(_,n)=>`Leistungsbaustein ${n+1}: persönliche Reflexion und Orientierung.`).join('\n');
 const bytes=await financePdf({invoice:{...invoice,description}}),parsed=await extract(bytes);
 assert.ok(parsed.pages.length>2);assert.ok(parsed.text.includes('Leistungsbaustein 200'));assert.ok(parsed.text.includes('2.863,00'));
 for(const page of parsed.pages){assert.ok(page.text.includes('Seite '));assert.ok(page.text.includes('DE311109135'));}
});
test('correction uses its own number/date and references the unchanged invoice',async()=>{
 const parsed=await extract(await financePdf({invoice,correction:{document_number:'FDD-GS-2026-000012',booked_at:'2026-09-22',amount:119,net:100,vat:19,reason:'Vereinbarte Preisreduzierung'}}));
 assert.match(parsed.text,/Rechnungskorrektur/);assert.match(parsed.text,/FDD-GS-2026-000012/);assert.match(parsed.text,/22.09.2026/);assert.match(parsed.text,/FDD-RE-2026-000123/);assert.match(parsed.text,/Korrekturbetrag/);assert.doesNotMatch(parsed.text,/Bitte begleiche|sofort ohne Abzug/);
});
test('invoice archive preserves original and returns winning concurrent presentation',async()=>{
 const original=Buffer.from('historical original'),winner=Buffer.from('winning presentation'),writes=[];
 const base={config:{url:'https://test'},headers:{},invoice};
 const fetcher=async(url,options)=>{
  if(options?.method==='POST'){writes.push(url);assert.equal(options.headers['x-upsert'],'false');return new Response(null,{status:409});}
  if(url.endsWith('.design-v2.pdf'))return writes.length?new Response(winner):new Response(null,{status:404});
  return new Response(original);
 };
 assert.deepEqual(await archivedInvoiceDocument({...base,fetcher}),winner);assert.equal(writes.length,1);assert.match(writes[0],/design-v2/);
 assert.deepEqual(await archivedInvoiceDocument({...base,fetcher,original:true}),original);
});
test('archive does not treat authorization or generic 400 failures as missing objects',async()=>{
 for(const status of [400,401,403,500]){let calls=0;await assert.rejects(archivedInvoiceDocument({config:{url:'https://test'},headers:{},invoice,fetcher:async()=>{calls++;return Response.json({message:'failure'},{status});}}),/Archiv|archiv/);assert.equal(calls,1);}
});
