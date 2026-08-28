create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  company text,
  status text not null default 'lead',
  last_contact_at timestamptz,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.contacts
    add constraint contacts_status_check check (status in ('lead', 'qualified', 'proposal', 'won', 'lost'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  value numeric(12,2) not null default 0,
  stage text not null default 'lead',
  owner text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  priority text not null default 'normal',
  completed boolean not null default false,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;

create index if not exists contacts_company_idx on public.contacts(company);
create index if not exists deals_stage_idx on public.deals(stage);
create index if not exists tasks_completed_idx on public.tasks(completed);
create index if not exists contacts_created_at_idx on public.contacts(created_at desc);
