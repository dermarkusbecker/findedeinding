export const cents=value=>Math.round(Number(value||0)*100);
export function invoiceBalances(invoices,payments,today){
 return invoices.map(i=>{const paid=payments.filter(p=>p.invoice_id===i.id&&p.status==='booked'&&p.booked_at<=today).reduce((sum,p)=>sum+cents(p.amount),0),open=Math.max(0,cents(i.gross)-paid);return {...i,paid:paid/100,open:open/100,payment_status:i.status!=='issued'?i.status:open===0?'paid':paid?'partial':i.due_date<today?'overdue':'open'};});
}
export function financeReport(invoices,payments,{year,month=0,today}){
 year=Number(year);month=Number(month);
 if(!Number.isInteger(year)||year<2000||year>Number(today.slice(0,4))||!Number.isInteger(month)||month<0||month>12)throw new Error('Ungültiger Berichtszeitraum.');
 const from=`${year}-${String(month||1).padStart(2,'0')}-01`,end=month?new Date(Date.UTC(year,month,0)).toISOString().slice(0,10):`${year}-12-31`,to=end<today?end:today;
 if(from>to)throw new Error('Dieser Zeitraum liegt in der Zukunft.');
 const selected=invoices.filter(i=>i.status==='issued'&&i.invoice_date>=from&&i.invoice_date<=to);
 const incoming=payments.filter(p=>p.status==='booked'&&p.booked_at>=from&&p.booked_at<=to);
 const sum=(rows,key)=>rows.reduce((n,r)=>n+cents(r[key]),0)/100;
 const months=Array.from({length:month?1:Number(to.slice(5,7))},(_,index)=>{const key=`${year}-${String(month||index+1).padStart(2,'0')}`,rows=selected.filter(i=>i.invoice_date.startsWith(key));return{month:key,net:sum(rows,'net'),vat:sum(rows,'vat'),gross:sum(rows,'gross'),payments:sum(incoming.filter(p=>p.booked_at.startsWith(key)),'amount')};});
 return{from,to,net:sum(selected,'net'),vat:sum(selected,'vat'),gross:sum(selected,'gross'),payments:sum(incoming,'amount'),months,invoices:selected};
}
