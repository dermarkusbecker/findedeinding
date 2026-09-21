import {cents} from './finance.js';
export function distributeInstallments(total,count,firstDue){
 const amount=cents(total);if(!Number.isInteger(count)||count<1||count>120||amount<count)throw new Error('Bitte Anzahl und Gesamtbetrag der Raten prüfen.');
 const first=new Date(firstDue+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(firstDue)||Number.isNaN(+first)||first.toISOString().slice(0,10)!==firstDue)throw new Error('Bitte die erste Fälligkeit angeben.');
 return Array.from({length:count},(_,index)=>{const date=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+index,1,12));date.setUTCDate(Math.min(first.getUTCDate(),new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));return{amount:(Math.floor(amount/count)+(index===count-1?amount%count:0))/100,dueDate:date.toISOString().slice(0,10),status:'open',paidOn:''};});
}
export async function loadPaymentPlans({all,customerId}){
 const plans=await all(`finance_payment_plans?${customerId?`customer_id=eq.${customerId}&`:""}select=*&order=created_at.desc,id`);
 if(!plans.length)return[];
 const chunks=async(ids,path)=>{const out=[];for(let n=0;n<ids.length;n+=50)out.push(...await all(path(ids.slice(n,n+50).join(','))));return out;};
 const rates=await chunks(plans.map(p=>p.id),ids=>`finance_installment_balances?plan_id=in.(${ids})&select=*&order=position,id`);
 const allocations=await chunks(rates.map(r=>r.id),ids=>`finance_installment_allocations?installment_id=in.(${ids})&select=*&order=installment_id,invoice_id`);
 return plans.map(plan=>({...plan,rates:rates.filter(r=>r.plan_id===plan.id).map(r=>({...r,allocations:allocations.filter(a=>a.installment_id===r.id)})),open:rates.filter(r=>r.plan_id===plan.id).reduce((n,r)=>n+cents(r.open),0)/100}));
}
export function scheduledInvoiceBalances(invoices,plans,today){
 const active=plans.filter(p=>['active','paused'].includes(p.status));
 return invoices.map(invoice=>{const allocations=active.flatMap(p=>p.rates.flatMap(r=>(r.allocations||[]).filter(a=>a.invoice_id===invoice.id).map(a=>({plan:p,rate:r,allocation:a}))));if(!allocations.length)return invoice;
 const parts=allocations.map(({rate,allocation})=>({due:rate.due_date,open:Math.max(0,Math.min(cents(allocation.amount),cents(invoice.open)-cents(allocation.later_amount)))}));
 const due=parts.filter(p=>p.due<=today).reduce((s,p)=>s+p.open,0)/100,overdue=parts.filter(p=>p.due<today).reduce((s,p)=>s+p.open,0)/100;
 return{...invoice,installmentPlanId:allocations[0].plan.id,installmentStatus:allocations[0].plan.status,scheduledDue:due,scheduledOverdue:overdue,scheduledFuture:Math.max(0,cents(invoice.open)-cents(due))/100,nextDue:parts.filter(p=>p.open>0).map(p=>p.due).sort()[0]||null};});
}
