create table public.stripe_payment_sessions (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.user_profiles(id) on delete cascade,
 invoice_id uuid references public.finance_invoices(id) on delete set null,
 allocations jsonb not null check (jsonb_typeof(allocations)='array'),
 amount_cents bigint not null check (amount_cents > 0),
 stripe_session_id text not null unique,
 stripe_payment_intent text unique,
 checkout_url text not null,
 expires_at timestamptz not null,
 status text not null default 'open' check (status in ('open','paid','expired')),
 emailed_at timestamptz,
 paid_at timestamptz,
 created_at timestamptz not null default now()
);
create index stripe_payment_sessions_customer on public.stripe_payment_sessions(customer_id,created_at desc);
alter table public.stripe_payment_sessions enable row level security;
revoke all on public.stripe_payment_sessions from anon,authenticated;
grant all on public.stripe_payment_sessions to service_role;

create function public.finance_stripe_settle(p_session text,p_intent text,p_amount_cents bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 s public.stripe_payment_sessions; allocation jsonb; invoice public.finance_invoices;
 allocated bigint:=0; due_cents bigint; booked_cents bigint; surplus bigint:=0;
 booking_day date:=(now() at time zone 'Europe/Berlin')::date;
begin
 select * into s from public.stripe_payment_sessions where stripe_session_id=p_session for update;
 if s.id is null then raise exception 'Stripe-Session ist nicht bekannt'; end if;
 if s.status='paid' then
  if s.stripe_payment_intent is distinct from p_intent then raise exception 'Stripe-Zahlung widerspricht einer vorhandenen Buchung'; end if;
  return jsonb_build_object('alreadyBooked',true,'customerId',s.customer_id);
 end if;
 if s.status<>'open' or p_intent is null or p_intent='' or p_amount_cents<>s.amount_cents then
  raise exception 'Stripe-Zahlung passt nicht zur offenen Session';
 end if;
 perform id from public.user_profiles where id=s.customer_id for update;
 for allocation in select value from jsonb_array_elements(s.allocations) loop
  if (allocation->>'amountCents')::bigint<=0 then raise exception 'Ungültige Stripe-Zuordnung'; end if;
  allocated:=allocated+(allocation->>'amountCents')::bigint;
  select * into invoice from public.finance_invoices
   where id=(allocation->>'invoiceId')::uuid and status='issued'
    and lead_id in (select id from public.leads where converted_user_profile_id=s.customer_id
     or (id=(select source_lead_id from public.user_profiles where id=s.customer_id) and converted_user_profile_id is null))
   for update;
  if invoice.id is null then raise exception 'Stripe-Rechnung gehört nicht zum Kunden'; end if;
  due_cents:=greatest(0,round(public.finance_invoice_remaining(invoice.id)*100)::bigint);
  booked_cents:=least(due_cents,(allocation->>'amountCents')::bigint);
  if booked_cents>0 then
   insert into public.lead_payments(lead_id,invoice_id,amount,status,reference,booked_at,booking_key,payment_method)
   values(invoice.lead_id,invoice.id,booked_cents/100.0,'booked','Stripe · '||p_intent,booking_day,md5(s.id::text||':'||invoice.id::text)::uuid,'stripe');
  end if;
  surplus:=surplus+(allocation->>'amountCents')::bigint-booked_cents;
 end loop;
 if allocated<>s.amount_cents then raise exception 'Stripe-Zuordnungen passen nicht zum Betrag'; end if;
 if surplus>0 then
  select * into invoice from public.finance_invoices where id=(s.allocations->0->>'invoiceId')::uuid;
  insert into public.lead_payments(lead_id,invoice_id,amount,status,reference,booked_at,booking_key,payment_method)
  values(invoice.lead_id,null,surplus/100.0,'booked','Stripe-Überzahlung · '||p_intent,booking_day,md5(s.id::text||':surplus')::uuid,'stripe');
 end if;
 update public.stripe_payment_sessions set status='paid',stripe_payment_intent=p_intent,paid_at=now() where id=s.id;
 return jsonb_build_object('booked',true,'customerId',s.customer_id,'surplusCents',surplus);
end $$;
revoke all on function public.finance_stripe_settle(text,text,bigint) from public,anon,authenticated;
grant execute on function public.finance_stripe_settle(text,text,bigint) to service_role;
