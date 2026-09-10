create table if not exists public.service_tariffs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  product_label text not null,
  duration_label text not null,
  gross_price numeric(12,2) not null check (gross_price >= 0),
  payment_model text not null,
  payment_due text not null,
  additional_agreements text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_tariffs_single_default_idx
  on public.service_tariffs ((is_default))
  where is_default = true;

create index if not exists service_tariffs_active_order_idx
  on public.service_tariffs (is_active desc, sort_order asc, name asc);

alter table public.service_tariffs enable row level security;

insert into public.service_tariffs (
  code, name, description, product_label, duration_label, gross_price,
  payment_model, payment_due, is_active, is_default, sort_order
)
values (
  'fdd-8-wochen',
  'FDD 8-Wochen-Programm',
  'Persönlicher Finde-dein-Ding-Prozess mit Clara, digitalen Arbeitsbereichen und begleitenden Gesprächen.',
  'Finde dein Ding · 8-Wochen-Programm',
  '8 Wochen',
  2490.00,
  'Einmalzahlung',
  '7 Tage nach Abschluss',
  true,
  true,
  10
)
on conflict (code) do nothing;

alter table public.lead_contracts
  add column if not exists tariff_id uuid references public.service_tariffs(id) on delete set null;

create index if not exists lead_contracts_tariff_idx
  on public.lead_contracts (tariff_id);

comment on table public.service_tariffs is 'Zentrale Leistungspakete für Angebot, Verkaufsgespräch und Vertragsdokumente.';
comment on column public.lead_contracts.tariff_id is 'Zum Zeitpunkt des Abschlusses ausgewählter zentraler Tarif.';
