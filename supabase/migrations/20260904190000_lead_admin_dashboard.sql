create table if not exists public.lead_contracts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  contract_number text,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'cancelled')),
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'booked' check (status in ('pending', 'booked', 'cancelled')),
  reference text,
  booked_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_communications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound', 'system')),
  subject text not null,
  preview text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  details text,
  due_at date,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_bank_accounts (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  account_holder text,
  iban text,
  bic text,
  payment_reference text,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_questions (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  week integer not null check (week between 1 and 8),
  question text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'archived')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_contracts_lead_created_idx on public.lead_contracts(lead_id, created_at desc);
create index if not exists lead_payments_lead_booked_idx on public.lead_payments(lead_id, booked_at desc);
create index if not exists lead_communications_lead_occurred_idx on public.lead_communications(lead_id, occurred_at desc);
create index if not exists lead_tasks_lead_due_idx on public.lead_tasks(lead_id, completed, due_at);
create index if not exists customer_questions_profile_created_idx on public.customer_questions(user_profile_id, created_at desc);

alter table public.lead_contracts enable row level security;
alter table public.lead_payments enable row level security;
alter table public.lead_communications enable row level security;
alter table public.lead_tasks enable row level security;
alter table public.lead_bank_accounts enable row level security;
alter table public.customer_questions enable row level security;

comment on table public.customer_questions is 'Vom Kunden im Acht-Wochen-Portal gestellte Fragen für die Admin-Aufgabenansicht.';
comment on table public.lead_payments is 'Manuell bestätigte Zahlungseingänge zum Abgleich des offenen Kundensaldos.';
