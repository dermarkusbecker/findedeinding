-- FDD CRM: Lead-Bearbeitung, Verkaufsgespräch, Google Calendar/Meet und Konvertierung
-- Einmal vollständig im Supabase SQL Editor ausführen.

alter table public.leads
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists internal_notes text,
  add column if not exists qualification_answers jsonb not null default '{}'::jsonb,
  add column if not exists appointment_start timestamptz,
  add column if not exists appointment_end timestamptz,
  add column if not exists appointment_timezone text not null default 'Europe/Berlin',
  add column if not exists calendar_event_id text,
  add column if not exists calendar_event_url text,
  add column if not exists meet_url text,
  add column if not exists converted_user_profile_id uuid,
  add column if not exists converted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.leads drop constraint if exists leads_status_check;
update public.leads set status = 'contacted' where status = 'qualified';
alter table public.leads add constraint leads_status_check
  check (status in ('new','contacted','scheduled','consultation','offer','customer','lost'));

do $$ begin
  alter table public.leads add constraint leads_converted_user_profile_id_fkey
    foreign key (converted_user_profile_id) references public.user_profiles(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.integration_settings (
  provider text primary key,
  encrypted_credentials text not null,
  connected_email text,
  updated_at timestamptz not null default now()
);

alter table public.integration_settings enable row level security;
create index if not exists leads_appointment_start_idx on public.leads(appointment_start);
create index if not exists leads_converted_profile_idx on public.leads(converted_user_profile_id);
