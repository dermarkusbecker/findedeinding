import {financeReportPdf} from './finance-report-pdf.js';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
import {validateInvoice,invoiceDate as date,invoiceMoney as money} from './invoice-document.js';
const hex=s=>rgb(...s.match(/../g).map(v=>parseInt(v,16)/255));
const ink=hex('123747'),muted=hex('536c78'),orange=hex('ff5500'),pale=hex('f1f6f7'),line=hex('d9e3e7'),white=rgb(1,1,1);
const W=595.28,H=841.89,M=43,C=W-2*M;
let assets;
const loadAssets=()=>assets ||= Promise.all(['fdd-logo.png','fonts/manrope-400.ttf','fonts/manrope-700.ttf'].map(f=>readFile(new URL('../assets/'+f,import.meta.url))));
export async function financePdf({invoice,report,details=false,correction}) {
 if(report)return financeReportPdf(report,{details});
 const i=validateInvoice(invoice),issuer=i.issuer,d=i.document_details||{};
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const [logoBytes,regularBytes,boldBytes]=await loadAssets();
 const font=await pdf.embedFont(regularBytes,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true}),logo=await pdf.embedPng(logoBytes);
 const number=correction?.document_number||i.invoice_number,title=correction?'Rechnungskorrektur':'Rechnung';
 const gross=correction?Number(correction.amount):Number(i.gross),net=correction?Number(correction.net):Number(i.net),vat=correction?Number(correction.vat):Number(i.vat);
 if(correction&&(!number||!Number.isFinite(gross)||gross<=0||gross>Number(i.gross)||Math.round(net*100)+Math.round(vat*100)!==Math.round(gross*100)))throw new Error('Ungültige Rechnungskorrektur.');
 pdf.setTitle(`${title} ${number} | Finde dein Ding`);pdf.setAuthor(issuer.issuer_name);pdf.setSubject(correction?`Korrektur zu ${i.invoice_number}`:i.description);pdf.setCreator('Finde dein Ding · Rechnungswesen');
 let page,y;
 const clean=v=>String(v??'').normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f]/g,'');
 const wrap=(v,width,size=9.5,strong=false)=>{
  const f=strong?bold:font,out=[];
  for(const p of clean(v).split('\n')){let row='';for(const word of p.split(/\s+/)){const candidate=(row?row+' ':'')+word;if(f.widthOfTextAtSize(candidate,size)<=width){row=candidate;continue;}if(row)out.push(row);row='';for(const char of word){if(row&&f.widthOfTextAtSize(row+char,size)>width){out.push(row);row='';}row+=char;}}out.push(row);}
  return out;
 };
 const text=(v,x,top,{size=9.5,strong=false,tone=ink,right=false}={})=>{const f=strong?bold:font,s=clean(v);page.drawText(s,{x:right?x-f.widthOfTextAtSize(s,size):x,y:top-size,font:f,size,color:tone});};
 const rect=(x,top,w,h,tone)=>page.drawRectangle({x,y:top-h,width:w,height:h,color:tone});
 const rule=top=>rect(M,top,C,.7,line);
 const addPage=()=>{
  page=pdf.addPage([W,H]);rect(0,H,W,5,orange);
  // The original logo includes transparent margins; position its visible mark in the header.
  page.drawImage(logo,{x:M-7,y:H-146,width:232,height:232*logo.height/logo.width});
  text('DEIN WEG. DEINE KLARHEIT.',W-M,H-47,{size:8,strong:true,tone:muted,right:true});
  rule(H-109);y=H-134;
  if(pdf.getPageCount()>1){text(`${title} · ${number}`,M,y,{size:12,strong:true});y-=30;}
 };
 const room=height=>{if(y-height<113)addPage();};
 const paragraph=(value,{size=9.5,tone=ink,strong=false,width=C,gap=10}={})=>{for(const row of wrap(value,width,size,strong)){room(size+5);text(row,M,y,{size,tone,strong});y-=size+5;}y-=gap;};
 addPage();
 const sender=wrap(`${issuer.issuer_name} · ${issuer.issuer_address.replace(/\n/g,' · ')}`,C,7);
 for(const row of sender){text(row,M,y,{size:7,tone:muted});y-=11;}
 y-=18;
 const recipient=wrap(`${i.customer_name}\n${i.customer_address}`,265,10.5);
 const meta=[['Rechnungsnummer',number],['Rechnungsdatum',date(correction?.booked_at||i.invoice_date)],...(!correction?[['Fällig am',date(i.due_date)]]:[]),...(d.customer_number?[['Kundennummer',d.customer_number]]:[])];
 const top=y;
 recipient.forEach((v,n)=>text(v,M,top-n*16,{size:10.5,strong:n===0}));
 let my=top;
 for(const [index,[label,value]] of meta.entries()){
  if(index===0){text(label,337,my,{size:7.5,tone:muted});my-=13;for(const row of wrap(value,W-M-337,9,true)){text(row,337,my,{size:9,strong:true});my-=14;}my-=8;}
  else {text(label,337,my,{size:7.5,tone:muted});text(value,W-M,my,{size:8,strong:true,right:true});my-=21;}
 }
 y=Math.min(top-recipient.length*16,my)-22;
 room(100);text(title,M,y,{size:28,strong:true});y-=44;
 if(correction)paragraph(`Bezug: ${i.invoice_number} vom ${date(i.invoice_date)}.\n${correction.reason}`,{tone:muted});
 else paragraph('Vielen Dank für dein Vertrauen. Wir berechnen dir die folgende Leistung:',{tone:muted});
 const service=d.duration?`Leistungsbeginn: ${date(i.service_date)} · Vereinbarte Laufzeit: ${d.duration}`:`Leistungsdatum: ${date(i.service_date)}`;
 paragraph(service+(d.contract_number?`\nVertragsnummer: ${d.contract_number}`:''),{size:8.5,tone:muted,gap:13});
 const header=()=>{room(65);rect(M,y,C,27,ink);text('POS.',M+10,y-8,{size:7.5,strong:true,tone:white});text('LEISTUNG',M+42,y-8,{size:7.5,strong:true,tone:white});text('MENGE',M+292,y-8,{size:7.5,strong:true,tone:white});text('NETTO',W-M-10,y-8,{size:7.5,strong:true,tone:white,right:true});y-=27;};
 header();
 const rows=wrap(i.description+(d.product&&d.product!==i.description?'\n'+d.product:''),237,9.5,true);let offset=0;
 while(offset<rows.length){if(y<158){addPage();header();}const count=Math.min(rows.length-offset,Math.max(1,Math.floor((y-125)/15))),height=count*15+24;rect(M,y,C,height,pale);
  if(!offset){text('01',M+10,y-12,{size:9,tone:muted});text('1',M+306,y-12,{size:9});const value=money(net);text(value,W-M-10,y-12,{size:Math.min(10,142/bold.widthOfTextAtSize(value,1)),strong:true,right:true});}
  rows.slice(offset,offset+count).forEach((v,n)=>text(v,M+42,y-12-n*15,{size:9.5,strong:true}));y-=height;offset+=count;
 }
 y-=23;room(126);
 const left=310,right=W-M;
 text('Nettobetrag',left,y,{tone:muted});text(money(net),right-10,y,{right:true});y-=25;
 text(`Umsatzsteuer ${Number(i.vat_rate).toLocaleString('de-DE')} %`,left,y,{tone:muted});text(money(vat),right-10,y,{right:true});y-=27;
 rect(left-12,y+8,right-left+12,50,ink);rect(left-12,y+8,3,50,orange);
 text(correction?'Korrekturbetrag':'Gesamtbetrag',left,y-1,{size:8.5,tone:white});
 const total=money(gross);text(total,right-10,y-17,{size:Math.min(19,(right-left-8)/bold.widthOfTextAtSize(total,1)),strong:true,tone:white,right:true});y-=70;
 if(Number(i.vat_rate)===0)paragraph(issuer.tax_note,{size:9,tone:muted});
 room(100);text(correction?'Verrechnung':'Zahlungsinformationen',M,y,{size:11,strong:true});y-=23;
 if(correction)paragraph('Dieser Beleg mindert die oben bezeichnete Rechnung. Bereits erfasste Zahlungen bleiben berücksichtigt. Ein verbleibendes Guthaben wird im Kundenkonto ausgewiesen.',{tone:muted});
 else {
  paragraph(i.due_date===i.invoice_date?'Der Rechnungsbetrag ist sofort ohne Abzug fällig.':`Bitte begleiche den Rechnungsbetrag bis zum ${date(i.due_date)} ohne Abzug.`,{gap:6});
  if(issuer.iban){paragraph(`Kontoinhaber: ${issuer.account_holder||issuer.issuer_name}\nIBAN: ${issuer.iban}${issuer.bic?'\nBIC: '+issuer.bic:''}${issuer.bank_name?'\nBank: '+issuer.bank_name:''}`,{size:9,gap:6});}
  else paragraph('Bitte nutze den vereinbarten Zahlungsweg.',{size:9,tone:muted,gap:6});
  paragraph(`Verwendungszweck: ${number}`,{size:9,strong:true,gap:6});
  paragraph('Bereits geleistete Zahlungen und vereinbarte Ratenpläne werden im Kundenkonto berücksichtigt.',{size:8,tone:muted});
 }
 // Footer is repeated, below the reserved content area, with the issuer snapshot.
 const pages=pdf.getPages();
 pages.forEach((p,index)=>{page=p;rule(96);
  const blocks=[[issuer.issuer_name,issuer.issuer_address],[issuer.email||'',issuer.phone||'',issuer.website||''].filter(Boolean),[/^[A-Z]{2}/.test(issuer.tax_id)?'USt-IdNr.':'Steuernummer',issuer.tax_id]];
  blocks.forEach((values,n)=>{let yy=82;for(const value of values)for(const row of wrap(value,155,7)){text(row,M+n*174,yy,{size:7,tone:muted});yy-=10;}});
  text(`Finde dein Ding · ${number}`,M,20,{size:7,tone:muted});text(`Seite ${index+1} von ${pages.length}`,W-M,20,{size:7,tone:muted,right:true});
 });
 return Buffer.from(await pdf.save());
}
