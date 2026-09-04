alter table public.lead_communications
  add column if not exists body text,
  add column if not exists channel text not null default 'email',
  add column if not exists delivery_status text not null default 'logged',
  add column if not exists read_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.lead_communications
set body = coalesce(body, preview),
    delivery_status = case
      when direction = 'inbound' then 'received'
      when direction = 'system' then 'system'
      else 'logged'
    end
where body is null or delivery_status = 'logged';

create index if not exists lead_communications_mailbox_idx
  on public.lead_communications(direction, read_at, occurred_at desc);

create index if not exists lead_communications_delivery_idx
  on public.lead_communications(delivery_status, occurred_at desc);

comment on column public.lead_communications.delivery_status is 'draft = vorbereitet, logged = manuell dokumentiert, sent/received/system = über eine Schnittstelle verarbeitet.';
comment on column public.lead_communications.read_at is 'Admin-Lesezeitpunkt für eingehende Kommunikation im CRM-Postfach.';
