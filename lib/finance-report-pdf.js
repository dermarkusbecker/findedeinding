import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {readFile} from 'node:fs/promises';
const color=hex=>rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255);
const ink=color('153e50'),muted=color('56727e'),orange=color('ff9453'),pale=color('edf4f7'),white=rgb(1,1,1);
const currency=value=>Number(value||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' EUR';
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('.'):'–';
const safe=value=>String(value??'').replace(/[^\x20-\x7e\xa0-\xff\n€–—]/g,'?').replace(/—/g,'–');
export async function financeReportPdf(report,{details=false}={}){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const logo=await pdf.embedPng(await readFile(new URL('../assets/fdd-logo.png',import.meta.url)));
 const W=841.89,H=595.28,M=36,C=W-2*M;let page,y,pageSection='Finanzübersicht';
 pdf.setTitle(`Finde dein Ding · Finanzübersicht ${report.from} bis ${report.to}`);pdf.setAuthor('Finde dein Ding · Markus Becker');pdf.setSubject('Rechnungsumsatz, Umsatzsteuer und Zahlungseingänge');
 const text=(value,x,top,{size=10,strong=false,tone=ink,right=false}={})=>{const f=strong?bold:font,s=safe(value);page.drawText(s,{x:right?x-f.widthOfTextAtSize(s,size):x,y:top-size,font:f,size,color:tone});};
 const rect=(x,top,w,h,tone)=>page.drawRectangle({x,y:top-h,width:w,height:h,color:tone});
 const wrap=(value,width,size=9,strong=false)=>{const f=strong?bold:font,lines=[];for(const paragraph of safe(value).split('\n')){let row='';for(const word of paragraph.split(/\s+/)){if(f.widthOfTextAtSize((row?row+' ':'')+word,size)<=width){row+=(row?' ':'')+word;continue;}if(row)lines.push(row);row='';for(const char of word){if(f.widthOfTextAtSize(row+char,size)>width){lines.push(row);row='';}row+=char;}}lines.push(row);}return lines;};
 const addPage=()=>{page=pdf.addPage([W,H]);rect(0,H,W,82,ink);const scale=210/logo.width;page.drawImage(logo,{x:M,y:H-41-logo.height*scale/2,width:210,height:logo.height*scale});text('STEUERBERATERPORTAL',W-M,H-22,{size:10,strong:true,tone:orange,right:true});text(`${date(report.from)} – ${date(report.to)}`,W-M,H-42,{size:11,tone:white,right:true});rect(0,H-82,W,3,orange);y=H-108;text(pageSection,M,y,{size:22,strong:true});y-=38;};
 const section=title=>{if(y<150)addPage();text(title,M,y,{size:13,strong:true});y-=25;};
 const note=value=>{for(const line of wrap(value,C,9)){if(y<55)addPage();text(line,M,y,{size:9,tone:muted});y-=14;}y-=8;};
 const table=(columns,rows)=>{
  const header=()=>{rect(M,y,C,27,ink);let x=M;for(const col of columns){text(col.label,col.right?x+col.width-9:x+9,y-8,{size:9,strong:true,tone:white,right:col.right});x+=col.width;}y-=27;};
  if(y<110)addPage();header();
  rows.forEach((row,index)=>{const cells=columns.map((col,n)=>wrap(row[n],col.width-18,9)),max=Math.max(...cells.map(c=>c.length));let offset=0;
   // Keep ordinary customer rows together; split only a row taller than a full page.
   if(max*13+16>y-58 && max*13+16<=H-108-38-27-58){addPage();header();}
   while(offset<max){if(y<88){addPage();header();}const count=Math.min(max-offset,Math.max(1,Math.floor((y-58-16)/13))),height=count*13+16;rect(M,y,C,height,index%2?pale:color('f9fbfc'));let x=M;
    columns.forEach((col,n)=>{cells[n].slice(offset,offset+count).forEach((line,l)=>text(line,col.right?x+col.width-9:x+9,y-8-l*13,{size:9,right:col.right}));x+=col.width;});y-=height;offset+=count;
   }
  });y-=14;
 };
 addPage();note(`Rechnungsregister · ${report.invoiceCount??report.invoices.length} ausgestellte Rechnungen · ${details?'Mit Einzelkunden und Vertragsdetails':'Kompaktübersicht'}`);
 const cards=[['NETTOUMSATZ',report.net],['UMSATZSTEUER',report.vat],['BRUTTOUMSATZ',report.gross],['ZAHLUNGSEINGÄNGE',report.payments]],gap=12,cw=(C-gap*3)/4;
 cards.forEach(([label,value],index)=>{const x=M+index*(cw+gap);rect(x,y,cw,63,pale);rect(x,y,3,63,index===2?orange:color('b8ccd6'));text(label,x+14,y-13,{size:8,strong:true,tone:muted});const labelMoney=currency(value),size=Math.min(18,(cw-28)/bold.widthOfTextAtSize(labelMoney,1));text(labelMoney,x+14,y-34,{size,strong:true});});y-=80;
 section('01  Monatsübersicht');
 const mw=C/5;table([{label:'Monat',width:mw},...['Netto','Umsatzsteuer','Brutto','Zahlungseingänge'].map(label=>({label,width:mw,right:true}))],report.months.map(m=>[new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}),currency(m.net),currency(m.vat),currency(m.gross),currency(m.payments)]));
 section('02  Umsatzsteuer nach Steuersatz');table([{label:'Steuersatz',width:C/4},...['Netto','Umsatzsteuer','Brutto'].map(label=>({label,width:C/4,right:true}))],(report.rates||[]).length?report.rates.map(r=>[`${r.rate.toLocaleString('de-DE')} %`,currency(r.net),currency(r.vat),currency(r.gross)]):[['Keine Rechnungen im Zeitraum','—','—','—']]);
 section('03  Einordnung der Zahlen');note('Rechnungsumsatz: ausgestellte Rechnungen nach Rechnungsdatum im gewählten Zeitraum. Zahlungseingänge: gebuchte Zahlungen nach Buchungsdatum im selben Zeitraum, auch zu Rechnungen anderer Monate. Beide Werte sind getrennt zu betrachten.');note(`Zahlungsstand der hier ausgewiesenen Rechnungen zum ${date(report.to)}: zugeordnet ${currency(report.paid)} · offen ${currency(report.open)}. Nicht zugeordnete Zahlungen reduzieren den offenen Rechnungsbetrag erst nach Zuordnung.`);note('Diese Übersicht enthält keine Betriebsausgaben und keine Umsatzsteuer-Voranmeldung. Sie dient der Abstimmung des CRM-Rechnungsregisters mit der Steuerberatung.');
 if(details){pageSection='Einzelkunden & Vertragsbelege';addPage();note(`Rechnungsdatum ${date(report.from)} bis ${date(report.to)} · Zahlungsstand am ${date(report.to)}`);
 const columns=[{label:'Rechnung / Datum',width:115},{label:'Kunde / Anschrift',width:150},{label:'Vertrag / Leistung',width:156},...['Netto','USt.','Brutto','Offen'].map(label=>({label,width:(C-421)/4,right:true}))];
 for(const month of report.months){const rows=report.invoices.filter(i=>i.invoice_date.startsWith(month.month));if(!rows.length)continue;section(new Date(`${month.month}-01T12:00:00Z`).toLocaleDateString('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}));table(columns,rows.map(i=>[`${i.invoice_number}\n${date(i.invoice_date)}\nFällig: ${date(i.due_date)}`,`${i.customer_name}\n${i.customer_address||''}`,`${i.contract?.contract_number||i.contract_number||i.contract_id}\n${i.description}\nLeistung ab ${date(i.service_date)}`,currency(i.net),`${currency(i.vat)}\n${Number(i.vat_rate||0)} %`,currency(i.gross),`${currency(i.open)}\n${i.open===0?'Bezahlt':i.paid?'Teilbezahlt':'Offen'}`]));}
 if(!report.invoices.length)note('Im ausgewählten Zeitraum wurden keine Rechnungen ausgestellt.');
 }
 const pages=pdf.getPages();pages.forEach((p,index)=>{page=p;rect(M,38,C,1,color('d5e1e6'));text('Finde dein Ding · Markus Becker | Vertrauliche Finanzübersicht',M,29,{size:8,tone:muted});text(`Seite ${index+1} / ${pages.length}`,W-M,29,{size:8,tone:muted,right:true});});
 return Buffer.from(await pdf.save());
}
