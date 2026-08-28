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

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  challenge text,
  source text not null default 'website',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'customer', 'lost')),
  consent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'coach', 'participant')),
  status text not null default 'invited' check (status in ('invited', 'active', 'paused', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.participant_progress (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  process_status text not null default 'ONBOARDING',
  current_week integer not null default 0 check (current_week between 0 and 8),
  completed_steps jsonb not null default '[]'::jsonb,
  privacy_consent_at timestamptz,
  start_commitment_at timestamptz,
  final_commitment_at timestamptz,
  last_activity_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.process_entries (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  week integer not null check (week between 1 and 8),
  data_block text not null,
  raw_answer text,
  structured_data jsonb not null default '{}'::jsonb,
  evidence_level text,
  created_at timestamptz not null default now()
);

create table if not exists public.week_gates (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  week integer not null check (week between 0 and 8),
  gate_key text not null,
  label text not null,
  required boolean not null default true,
  completed_at timestamptz,
  evidence_entry_id uuid references public.process_entries(id) on delete set null,
  unique(user_profile_id, week, gate_key)
);

create table if not exists public.clarity_measurements (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  phase text not null check (phase in ('start', 'midpoint', 'end')),
  score integer not null check (score between 1 and 10),
  reasoning text,
  measured_at timestamptz not null default now(),
  unique(user_profile_id, phase)
);

create table if not exists public.coach_escalations (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  reason text not null,
  escalation_type text not null check (escalation_type in ('q_and_a', 'blocked_gate', 'week_7_decision', 'technical')),
  status text not null default 'open' check (status in ('open', 'scheduled', 'resolved')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.implementation_plans (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade unique,
  chosen_direction text not null,
  decision_reasoning text,
  actions_24h jsonb not null default '[]'::jsonb,
  goals_30d jsonb not null default '[]'::jsonb,
  milestone_90d text,
  commitment_signed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.leads enable row level security;
alter table public.user_profiles enable row level security;
alter table public.participant_progress enable row level security;
alter table public.process_entries enable row level security;
alter table public.week_gates enable row level security;
alter table public.clarity_measurements enable row level security;
alter table public.coach_escalations enable row level security;
alter table public.implementation_plans enable row level security;

create index if not exists contacts_company_idx on public.contacts(company);
create index if not exists deals_stage_idx on public.deals(stage);
create index if not exists tasks_completed_idx on public.tasks(completed);
create index if not exists contacts_created_at_idx on public.contacts(created_at desc);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists process_entries_participant_idx on public.process_entries(user_profile_id, week);
create index if not exists week_gates_participant_idx on public.week_gates(user_profile_id, week);
create index if not exists coach_escalations_status_idx on public.coach_escalations(status, created_at desc);
