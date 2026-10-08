alter table public.booking_settings
  add column if not exists qa_categories jsonb not null default '[{"duration":15,"active":false},{"duration":30,"active":false},{"duration":45,"active":false},{"duration":60,"active":false}]'::jsonb;

create table if not exists public.crm_qa_bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  duration_minutes integer not null check (duration_minutes in (15,30,45,60)),
  appointment_start timestamptz not null,
  appointment_end timestamptz not null,
  google_event_id text,
  meet_url text,
  lead_id uuid references public.leads(id) on delete set null,
  user_profile_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint qa_booking_times check (appointment_end > appointment_start),
  constraint qa_booking_no_overlap exclude using gist (tstzrange(appointment_start,appointment_end,'[)') with &&)
);

create index if not exists crm_qa_bookings_time_idx on public.crm_qa_bookings (appointment_start, appointment_end);
alter table public.crm_qa_bookings enable row level security;
