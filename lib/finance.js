export const cents=value=>Math.round(Number(value||0)*100);
export function invoiceBalances(invoices,payments,today,events=[]){
 return invoices.map(i=>{
  const rows=events.filter(e=>e.invoice_id===i.id&&e.booked_at<=today),sum=kind=>rows.filter(e=>e.kind===kind).reduce((s,e)=>s+cents(e.amount),0);
  const credit=sum('credit'),writeoff=sum('writeoff'),paid=payments.filter(p=>p.invoice_id===i.id&&p.status==='booked'&&p.booked_at<=today).reduce((s,p)=>s+cents(p.amount),0),open=Math.max(0,cents(i.gross)-paid-credit-writeoff);
  const due=rows.filter(e=>e.kind==='due').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0]?.due_date||i.due_date;
  return {...i,original_due_date:i.due_date,due_date:due,paid:paid/100,credited:credit/100,written_off:writeoff/100,open:open/100,payment_status:i.status!=='issued'?i.status:open===0?(writeoff?'written_off':credit?(paid?'settled':'credited'):'paid'):paid?'partial':due<today?'overdue':'open'};
 });
}
export function financeReport(invoices,payments,{year,month=0,today,events=[]}){
 year=Number(year);month=Number(month);
 if(!Number.isInteger(year)||year<2000||year>Number(today.slice(0,4))||!Number.isInteger(month)||month<0||month>12)throw new Error('Ungültiger Berichtszeitraum.');
 const from=`${year}-${String(month||1).padStart(2,'0')}-01`,end=month?new Date(Date.UTC(year,month,0)).toISOString().slice(0,10):`${year}-12-31`,to=end<today?end:today;
 if(from>to)throw new Error('Dieser Zeitraum liegt in der Zukunft.');
 const selected=invoiceBalances(invoices.filter(i=>i.status==='issued'&&i.invoice_date>=from&&i.invoice_date<=to),payments,to,events).sort((a,b)=>a.invoice_date.localeCompare(b.invoice_date)||String(a.invoice_number).localeCompare(String(b.invoice_number)));
 const credits=events.filter(e=>e.kind==='credit'&&e.booked_at>=from&&e.booked_at<=to).map(e=>{const i=invoices.find(i=>i.id===e.invoice_id)||{};return {...i,id:e.id,source_invoice_number:i.invoice_number,invoice_number:e.document_number,invoice_date:e.booked_at,description:e.reason,net:-Number(e.net),vat:-Number(e.vat),gross:-Number(e.amount),open:0,paid:0,is_credit:true};});
 const revenue=[...selected,...credits];
 const incoming=payments.filter(p=>p.status==='booked'&&p.booked_at>=from&&p.booked_at<=to);
 const sum=(rows,key)=>rows.reduce((n,r)=>n+cents(r[key]),0)/100;
 const months=Array.from({length:month?1:Number(to.slice(5,7))},(_,index)=>{const key=`${year}-${String(month||index+1).padStart(2,'0')}`,rows=revenue.filter(i=>i.invoice_date.startsWith(key));return{month:key,net:sum(rows,'net'),vat:sum(rows,'vat'),gross:sum(rows,'gross'),payments:sum(incoming.filter(p=>p.booked_at.startsWith(key)),'amount')};});
 const rates=[...new Set(revenue.map(i=>Number(i.vat_rate||0)))].sort((a,b)=>a-b).map(rate=>{const rows=revenue.filter(i=>Number(i.vat_rate||0)===rate);return{rate,net:sum(rows,'net'),vat:sum(rows,'vat'),gross:sum(rows,'gross')};});
 return{from,to,rates,invoiceCount:selected.length,paid:sum(selected,'paid'),open:sum(selected,'open'),net:sum(revenue,'net'),vat:sum(revenue,'vat'),gross:sum(revenue,'gross'),payments:sum(incoming,'amount'),months,invoices:revenue,credits,writeoffs:events.filter(e=>e.kind==='writeoff'&&e.booked_at>=from&&e.booked_at<=to)};
}
