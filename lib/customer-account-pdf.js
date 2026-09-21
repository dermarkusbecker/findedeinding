import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
import {accountKinds,accountStatuses} from './customer-account.js';
const money=n=>Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' EUR';
const date=d=>String(d||'').split('-').reverse().join('.');
const safe=v=>String(v??'').replace(/[^\x20-\x7e\xa0-\xff\n€–]/g,'-');
export async function accountPdf(account,{event,invoice}={}){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),logo=await pdf.embedPng(await readFile(new URL('../assets/fdd-logo.png',import.meta.url)));
 const W=841.89,H=595.28,M=36,C=W-2*M,ink=rgb(.07,.22,.29),orange=rgb(1,.53,.25),muted=rgb(.34,.44,.49),pale=rgb(.94,.97,.98),white=rgb(1,1,1);let page,y;
 const title=event?(event.kind==='credit'?'Rechnungskorrektur (Gutschrift)':accountKinds[event.kind]+'sbeleg'):'Kontoauszug';
 pdf.setTitle(`Finde dein Ding · ${title} · ${account.profile.name}`);pdf.setAuthor('Finde dein Ding');
 const text=(v,x,top,size=10,strong=false,color=ink,right=false)=>{const f=strong?bold:font,s=safe(v);page.drawText(s,{x:right?x-f.widthOfTextAtSize(s,size):x,y:top-size,font:f,size,color});};
 const rect=(x,top,w,h,color)=>page.drawRectangle({x,y:top-h,width:w,height:h,color});
 const wrap=(v,width,size=9)=>{const out=[];for(const paragraph of safe(v).split('\n')){let row='';for(const word of paragraph.split(/\s+/)){if(font.widthOfTextAtSize((row?row+' ':'')+word,size)<=width){row+=(row?' ':'')+word;continue;}if(row)out.push(row);row='';for(const char of word){if(font.widthOfTextAtSize(row+char,size)>width){out.push(row);row='';}row+=char;}}out.push(row);}return out;};
 const add=()=>{page=pdf.addPage([W,H]);rect(0,H,W,76,ink);page.drawImage(logo,{x:M,y:H-38-(205*logo.height/logo.width)/2,width:205,height:205*logo.height/logo.width});text(title.toUpperCase(),W-M,H-25,12,true,orange,true);text(event?event.document_number:`Stand ${date(account.today)}`,W-M,H-46,10,false,white,true);rect(0,H-76,W,3,orange);y=H-101;text(account.profile.name,M,y,18,true);text(account.profile.customer_number||'Kundenkonto',W-M,y,10,false,muted,true);y-=30;};
 const note=v=>{for(const row of wrap(v,C,10)){if(y<65)add();text(row,M,y,10);y-=15;}y-=8;};
 const table=(cols,rows)=>{const header=()=>{rect(M,y,C,25,ink);let x=M;for(const c of cols){text(c.label,x+7,y-7,8,true,white);x+=c.width;}y-=25;};if(y<115)add();header();for(const [index,row] of rows.entries()){const cells=cols.map((c,n)=>wrap(row[n],c.width-14)),max=Math.max(...cells.map(c=>c.length));let offset=0;if(max*13+14>y-55&&max*13+14<350){add();header();}while(offset<max){if(y<90){add();header();}const count=Math.min(max-offset,Math.max(1,Math.floor((y-55-14)/13))),height=count*13+14;rect(M,y,C,height,index%2?pale:rgb(.985,.99,.995));let x=M;cols.forEach((c,n)=>{cells[n].slice(offset,offset+count).forEach((v,j)=>text(v,c.right?x+c.width-7:x+7,y-7-j*13,9,false,ink,c.right));x+=c.width;});offset+=count;y-=height;}}y-=18;};
 add();
 if(event){
  const issuer=invoice.issuer;note(`${issuer.issuer_name}\n${issuer.issuer_address}\nSteuernummer / USt-ID: ${issuer.tax_id}`);note(`Empfänger: ${invoice.customer_name}\n${invoice.customer_address}`);note(`Belegdatum: ${date(event.booked_at)} · Bezug: ${invoice.invoice_number} vom ${date(invoice.invoice_date)}`);note(`Leistung: ${invoice.description}\nLeistungsbeginn: ${date(invoice.service_date)}\nBuchungsgrund: ${event.reason}`);
  if(event.kind==='credit'){table([{label:'Netto',width:C/3},{label:`Umsatzsteuer ${invoice.vat_rate} %`,width:C/3},{label:'Gutschrift brutto',width:C/3}],[[money(event.net),money(event.vat),money(event.amount)]]);note('Dieser Beleg mindert die oben bezeichnete Rechnung. Bereits geleistete Zahlungen bleiben berücksichtigt. Ein verbleibendes Guthaben wird im Kundenkonto ausgewiesen.');}
  else if(event.kind==='writeoff'){note(`Ausgebuchter Forderungsbetrag: ${money(event.amount)}`);note('Interner Ausbuchungsbeleg. Kein Zahlungseingang. Eine umsatzsteuerliche Berichtigung ist hier nicht enthalten.');}
  else note(`Neue Fälligkeit: ${date(event.due_date)}. Der ursprüngliche Rechnungsbeleg bleibt unverändert.`);
 }else{
  const s=account.summary,cards=[['KONTOSALDO',s.balance],['AKTUELL FÄLLIG',s.due],['KÜNFTIG FÄLLIG',s.future],['ZAHLUNGSEINGÄNGE',s.payments]],cw=(C-30)/4;cards.forEach(([label,v],n)=>{const x=M+n*(cw+10);rect(x,y,cw,62,pale);text(label,x+12,y-12,8,true,muted);text(money(v),x+12,y-32,Math.min(16,(cw-24)/bold.widthOfTextAtSize(money(v),1)),true);});y-=78;
  note('Vollständiges Buchungsjournal bis zum Stichtag. Positive Beträge = Forderungen, negative Beträge = Zahlungen oder Entlastungen. Saldo positiv = Forderung; Saldo negativ = Kundenguthaben.');
  if(s.customerCredit)note(`Guthaben / nicht verrechnete Beträge: ${money(s.customerCredit)}. Offene Einzelrechnungen: ${money(s.open)}. Erst eine Rechnungszuordnung gleicht OPOS aus.`);
  const cols=[{label:'Datum / Art',width:100},{label:'Beleg / Buchungstext',width:260},{label:'Fällig / Status',width:135},{label:'Betrag',width:130,right:true},{label:'Saldo',width:C-625,right:true}];
  table(cols,account.entries.length?account.entries.map(e=>[`${date(e.date)}\n${accountKinds[e.kind]}`,`${e.number}\n${e.description}${e.invoiceNumber?'\nBezug: '+e.invoiceNumber:''}`,`${e.dueDate?date(e.dueDate)+'\n':''}${accountStatuses[e.status]||e.status}`,money(e.amount),money(e.balance)]):[['—','Keine Buchungen vorhanden','—',money(0),money(0)]]);
  note(`Schlusssaldo: ${money(s.balance)} · Gutschriften: ${money(s.credits)} · Ausbuchungen: ${money(s.writeoffs)}`);
  if(account.pendingInvoices)note(`${account.pendingInvoices} noch nicht ausgestellte Rechnungen sind im Saldo nicht enthalten.`);
  note('Dieser Kontoauszug dokumentiert das Kundenkonto. Einzelne Rechnungen und Rechnungskorrekturen sind die zugehörigen steuerlichen Belege.');
 }
 pdf.getPages().forEach((p,n)=>{page=p;rect(M,36,C,1,rgb(.82,.88,.9));text('Finde dein Ding · Vertrauliches Kundenkonto',M,27,8,false,muted);text(`Seite ${n+1} / ${pdf.getPageCount()}`,W-M,27,8,false,muted,true);});return Buffer.from(await pdf.save());
}
