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
  status text not null default 'new' check (status in ('new', 'contacted', 'scheduled', 'consultation', 'offer', 'customer', 'lost')),
  first_name text,
  last_name text,
  internal_notes text,
  qualification_answers jsonb not null default '{}'::jsonb,
  appointment_start timestamptz,
  appointment_end timestamptz,
  appointment_timezone text not null default 'Europe/Berlin',
  calendar_event_id text,
  calendar_event_url text,
  meet_url text,
  converted_user_profile_id uuid,
  converted_at timestamptz,
  updated_at timestamptz not null default now(),
  consent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_settings (
  provider text primary key,
  encrypted_credentials text not null,
  connected_email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_settings (
  id text primary key default 'default' check (id = 'default'),
  timezone text not null default 'Europe/Berlin',
  weekly_availability jsonb not null default '{"0":[],"1":[],"2":[],"3":[],"4":[],"5":[],"6":[]}'::jsonb,
  slot_interval_minutes integer not null default 15 check (slot_interval_minutes in (15, 30)),
  default_duration_minutes integer not null default 45 check (default_duration_minutes in (30, 45, 60, 90)),
  min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 168),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 7 and 180),
  updated_at timestamptz not null default now()
);

insert into public.booking_settings (id) values ('default') on conflict (id) do nothing;

create table if not exists public.lead_contracts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  contract_number text,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'cancelled')),
  signed_at timestamptz,
  document_confirmed_at timestamptz,
  video_contract_confirmed_at timestamptz,
  program_start_date date,
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

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  portal_username text unique,
  customer_number text unique,
  must_change_password boolean not null default false,
  one_time_password_issued_at timestamptz,
  access_invite_sent_at timestamptz,
  password_changed_at timestamptz,
  name text not null,
  email text not null unique,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  permissions text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.leads add constraint leads_converted_user_profile_id_fkey
    foreign key (converted_user_profile_id) references public.user_profiles(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.participant_progress (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  process_status text not null default 'ONBOARDING',
  current_week integer not null default 0 check (current_week between 0 and 8),
  program_start_date date not null default current_date,
  access_mode text not null default 'time_based' check (access_mode = 'time_based'),
  program_status text not null default 'active' check (program_status in ('active', 'paused')),
  manually_unlocked_weeks integer[] not null default '{}'::integer[],
  manually_locked_weeks integer[] not null default '{}'::integer[],
  completed_steps jsonb not null default '[]'::jsonb,
  privacy_consent_at timestamptz,
  start_commitment_at timestamptz,
  final_commitment_at timestamptz,
  last_activity_at timestamptz,
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

create table if not exists public.gate_week_settings (
  week integer primary key check (week between 0 and 8),
  title text not null check (char_length(title) between 2 and 120),
  description text not null check (char_length(description) between 5 and 600),
  default_title text not null,
  default_description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null
);

create table if not exists public.gate_template_settings (
  gate_key text primary key,
  week integer not null references public.gate_week_settings(week) on delete cascade,
  label text not null check (char_length(label) between 2 and 240),
  default_label text not null,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  unique (week, sort_order)
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

create table if not exists public.clarity_questions (
  question_key text primary key,
  week integer not null check (week between 1 and 8),
  step_id text not null,
  title text not null,
  prompt_text text not null check (char_length(prompt_text) between 5 and 2000),
  default_prompt_text text not null check (char_length(default_prompt_text) between 5 and 2000),
  prompt_type text not null default 'dialog',
  sort_order integer not null default 0,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  unique (week, step_id)
);

alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.leads enable row level security;
alter table public.integration_settings enable row level security;
alter table public.booking_settings enable row level security;
alter table public.lead_contracts enable row level security;
alter table public.lead_payments enable row level security;
alter table public.lead_communications enable row level security;
alter table public.lead_tasks enable row level security;
alter table public.lead_bank_accounts enable row level security;
alter table public.user_profiles enable row level security;
alter table public.participant_progress enable row level security;
alter table public.customer_questions enable row level security;
alter table public.process_entries enable row level security;
alter table public.week_gates enable row level security;
alter table public.gate_week_settings enable row level security;
alter table public.gate_template_settings enable row level security;
alter table public.clarity_measurements enable row level security;
alter table public.coach_escalations enable row level security;
alter table public.implementation_plans enable row level security;
alter table public.clarity_questions enable row level security;

create index if not exists contacts_company_idx on public.contacts(company);
create index if not exists deals_stage_idx on public.deals(stage);
create index if not exists tasks_completed_idx on public.tasks(completed);
create index if not exists contacts_created_at_idx on public.contacts(created_at desc);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists lead_contracts_lead_created_idx on public.lead_contracts(lead_id, created_at desc);
create index if not exists lead_payments_lead_booked_idx on public.lead_payments(lead_id, booked_at desc);
create index if not exists lead_communications_lead_occurred_idx on public.lead_communications(lead_id, occurred_at desc);
create index if not exists lead_tasks_lead_due_idx on public.lead_tasks(lead_id, completed, due_at);
create index if not exists customer_questions_profile_created_idx on public.customer_questions(user_profile_id, created_at desc);
create index if not exists process_entries_participant_idx on public.process_entries(user_profile_id, week);
create index if not exists week_gates_participant_idx on public.week_gates(user_profile_id, week);
create index if not exists gate_template_settings_week_order_idx on public.gate_template_settings(week, sort_order);
create index if not exists coach_escalations_status_idx on public.coach_escalations(status, created_at desc);
create index if not exists clarity_questions_week_order_idx on public.clarity_questions(week, sort_order);

-- Idempotente Migration für Projekte, in denen die Basistabellen bereits existieren.
alter table public.user_profiles add column if not exists portal_username text;
alter table public.user_profiles add column if not exists customer_number text;
alter table public.user_profiles add column if not exists must_change_password boolean not null default false;
alter table public.user_profiles add column if not exists one_time_password_issued_at timestamptz;
alter table public.user_profiles add column if not exists access_invite_sent_at timestamptz;
alter table public.user_profiles add column if not exists password_changed_at timestamptz;
alter table public.participant_progress add column if not exists program_start_date date not null default current_date;
alter table public.participant_progress add column if not exists access_mode text not null default 'time_based';
alter table public.participant_progress add column if not exists program_status text not null default 'active';
alter table public.participant_progress add column if not exists manually_unlocked_weeks integer[] not null default '{}'::integer[];
alter table public.participant_progress add column if not exists manually_locked_weeks integer[] not null default '{}'::integer[];

create unique index if not exists participant_progress_user_profile_unique on public.participant_progress(user_profile_id);
create unique index if not exists user_profiles_portal_username_unique on public.user_profiles(portal_username) where portal_username is not null;
create unique index if not exists user_profiles_customer_number_unique on public.user_profiles(customer_number) where customer_number is not null;
create unique index if not exists user_profiles_portal_username_lower_unique on public.user_profiles(lower(portal_username)) where portal_username is not null;

create sequence if not exists public.customer_number_seq start with 10001;

create or replace function public.assign_participant_login()
returns trigger
language plpgsql
set search_path = public
as $$
declare first_name text;
begin
  if 'clara_program' = any(coalesce(new.permissions, '{}'::text[])) then
    if new.customer_number is null or btrim(new.customer_number) = '' then
      new.customer_number := 'KD' || lpad(nextval('public.customer_number_seq')::text, 6, '0');
    end if;
    if new.portal_username is null or btrim(new.portal_username) = '' then
      first_name := regexp_replace(split_part(btrim(new.name), ' ', 1), '[^[:alnum:]-]', '', 'g');
      if first_name = '' then first_name := 'Kunde'; end if;
      new.portal_username := first_name || '_' || new.customer_number;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_participant_login_before_write on public.user_profiles;
create trigger assign_participant_login_before_write
before insert or update of permissions, name on public.user_profiles
for each row execute function public.assign_participant_login();

update public.participant_progress
set access_mode = 'time_based',
    manually_unlocked_weeks = '{}'::integer[],
    manually_locked_weeks = '{}'::integer[]
where access_mode is distinct from 'time_based'
   or cardinality(manually_unlocked_weeks) > 0
   or cardinality(manually_locked_weeks) > 0;
update public.participant_progress set program_status = 'active' where program_status is null;

do $$ begin
  alter table public.participant_progress add constraint participant_progress_access_mode_check
    check (access_mode = 'time_based');
exception when duplicate_object then null;
end $$;

create or replace function public.apply_gate_template_label()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  configured_label text;
begin
  select label into configured_label
  from public.gate_template_settings
  where gate_key = new.gate_key and week = new.week;
  new.label := coalesce(configured_label, new.label);
  return new;
end;
$$;

drop trigger if exists apply_gate_template_label_before_insert on public.week_gates;
create trigger apply_gate_template_label_before_insert
before insert on public.week_gates
for each row execute function public.apply_gate_template_label();

do $$ begin
  alter table public.participant_progress add constraint participant_progress_program_status_check
    check (program_status in ('active', 'paused'));
exception when duplicate_object then null;
end $$;
