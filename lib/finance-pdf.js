import {financeReportPdf} from './finance-report-pdf.js';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
const money=n=>Number(n||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' EUR';
export async function financePdf({invoice,report,details=false}){
 if(report)return financeReportPdf(report,{details});
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),width=595.28,height=841.89;let page,y;
 const safe=s=>String(s??'').replace(/[^\x20-\x7e\xa0-\xff\n]/g,'-');
 const add=()=>{page=pdf.addPage([width,height]);y=height-45;page.drawText('FINDE DEIN DING | Rechnung',{x:38,y,font:bold,size:17,color:rgb(.08,.24,.3)});y-=34;};
 const line=(text,emphasis=false)=>{const words=safe(text).split(/\s+/);let row='';for(const word of words){if(font.widthOfTextAtSize(row+' '+word,10)>width-80){print(row,emphasis);row=word;}else row+=(row?' ':'')+word;}if(row)print(row,emphasis);};
 const print=(text,emphasis)=>{if(y<45)add();page.drawText(text,{x:38,y,size:10,font:emphasis?bold:font});y-=17;};add();
 if(invoice){const i=invoice;line(i.invoice_number,true);line('Rechnungsdatum: '+i.invoice_date+' | Fällig: '+i.due_date);line('Rechnungssteller: '+i.issuer.issuer_name);for(const part of i.issuer.issuer_address.split('\n'))line(part);line('Steuernummer / USt-ID: '+i.issuer.tax_id);y-=16;line('Rechnung an: '+i.customer_name,true);for(const part of i.customer_address.split('\n'))line(part);y-=18;line('Leistung: '+i.description,true);line('Leistungsbeginn: '+i.service_date);line('Nettobetrag: '+money(i.net));line('Umsatzsteuer '+i.vat_rate+' %: '+money(i.vat));line('Gesamtbetrag: '+money(i.gross),true);y-=18;line('Bitte überweise den Gesamtbetrag bis zum '+i.due_date+' unter Angabe der Rechnungsnummer.');if(i.issuer.iban)line('IBAN: '+i.issuer.iban);}
 pdf.getPages().forEach((p,index)=>p.drawText(`Seite ${index+1} / ${pdf.getPageCount()}`,{x:38,y:22,size:9,font}));return Buffer.from(await pdf.save());
}
