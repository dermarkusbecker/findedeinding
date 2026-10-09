-- One source of truth for the payment threshold before week two.
create or replace view public.program_payment_gates as
select p.id as user_profile_id,
       coalesce(c.amount, 0)::numeric(12,2) as contract_value,
       coalesce(payment.paid, 0)::numeric(12,2) as paid_amount,
       greatest(coalesce(c.amount, 0) - coalesce(payment.paid, 0), 0)::numeric(12,2) as open_amount,
       case
         when coalesce(c.amount, 0) = 0 and coalesce(payment.paid, 0) = 0 then true
         when coalesce(c.amount, 0) > 0 and coalesce(payment.paid, 0) * 100 >= c.amount * 30 then true
         else false
       end as allowed
from public.user_profiles p
left join lateral (
  select id from public.leads
  where converted_user_profile_id = p.id or id = p.source_lead_id
  order by (id = p.source_lead_id) desc, converted_at desc nulls last
  limit 1
) l on true
left join lateral (
  select id, amount from public.lead_contracts
  where lead_id = l.id and status = 'signed' and archived_at is null
  order by signed_at desc nulls last, created_at desc
  limit 1
) c on true
left join lateral (
  select coalesce(sum(pay.amount), 0) as paid
  from public.finance_invoices invoice
  join public.lead_payments pay on pay.invoice_id = invoice.id
  where invoice.contract_id = c.id
    and pay.status = 'booked'
    and pay.booked_at <= (now() at time zone 'Europe/Berlin')::date
) payment on true
where p.role = 'user';

revoke all on public.program_payment_gates from public, anon, authenticated;
grant select on public.program_payment_gates to service_role;
