alter table public.user_profiles
  add column if not exists mobile_phone text,
  add column if not exists whatsapp_same_as_mobile boolean not null default true,
  add column if not exists profile_photo_path text;

alter table public.lead_communications
  add column if not exists provider_message_id text;
create unique index if not exists lead_communications_provider_message_unique
  on public.lead_communications(provider_message_id);

update public.user_profiles
set mobile_phone = phone
where role = 'user' and mobile_phone is null and phone is not null;

update public.user_profiles
set whatsapp_same_as_mobile = false
where role = 'user'
  and whatsapp_phone is not null
  and mobile_phone is not null
  and regexp_replace(whatsapp_phone, '\D', '', 'g') <> regexp_replace(mobile_phone, '\D', '', 'g');

update public.user_profiles
set whatsapp_phone = mobile_phone
where role = 'user' and whatsapp_same_as_mobile = true and whatsapp_phone is null and mobile_phone is not null;

create table if not exists public.participant_documents (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  week integer not null default 0 check (week between 0 and 8),
  document_type text not null,
  original_file_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  storage_bucket text not null,
  storage_path text not null unique,
  sha256 text,
  processing_status text not null default 'uploaded',
  extraction_method text,
  extracted_text text,
  extracted_data jsonb not null default '{}'::jsonb,
  extraction_version text,
  participant_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.participant_documents
  add column if not exists display_title text,
  add column if not exists source text not null default 'customer',
  add column if not exists visibility text not null default 'customer',
  add column if not exists uploaded_by_profile_id uuid references public.user_profiles(id) on delete set null;

alter table public.participant_documents drop constraint if exists participant_documents_document_type_check;
alter table public.participant_documents
  add constraint participant_documents_document_type_check
  check (document_type in ('start_commitment','cv','workbook','other','contract','video_contract','shared'));

alter table public.participant_documents drop constraint if exists participant_documents_processing_status_check;
alter table public.participant_documents
  add constraint participant_documents_processing_status_check
  check (processing_status in ('uploaded','extracting','needs_ocr','ready','failed'));

alter table public.participant_documents drop constraint if exists participant_documents_source_check;
alter table public.participant_documents
  add constraint participant_documents_source_check check (source in ('customer','staff','system'));

alter table public.participant_documents drop constraint if exists participant_documents_visibility_check;
alter table public.participant_documents
  add constraint participant_documents_visibility_check check (visibility in ('customer','staff'));

create index if not exists participant_documents_lookup_idx
  on public.participant_documents(user_profile_id, week, created_at desc);

create table if not exists public.customer_appointments (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null default 'Kundentermin',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Europe/Berlin',
  google_event_id text,
  google_event_url text,
  meet_url text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  source text not null default 'google_calendar' check (source in ('google_calendar','crm')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_appointments_google_event_unique
  on public.customer_appointments(google_event_id);
create index if not exists customer_appointments_participant_start_idx
  on public.customer_appointments(user_profile_id, starts_at desc);

insert into public.customer_appointments (
  user_profile_id, lead_id, title, starts_at, ends_at, timezone,
  google_event_id, google_event_url, meet_url, status, source
)
select
  converted_user_profile_id, id, 'Kundengespräch', appointment_start,
  coalesce(appointment_end, appointment_start + interval '45 minutes'),
  appointment_timezone, calendar_event_id, calendar_event_url, meet_url,
  case when coalesce(appointment_end, appointment_start) < now() then 'completed' else 'scheduled' end,
  'google_calendar'
from public.leads
where converted_user_profile_id is not null
  and appointment_start is not null
  and calendar_event_id is not null
on conflict (google_event_id) do update
set starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    google_event_url = excluded.google_event_url,
    meet_url = excluded.meet_url,
    updated_at = now();

alter table public.participant_documents enable row level security;
alter table public.customer_appointments enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('participant-documents','participant-documents',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp']),
  ('participant-avatars','participant-avatars',false,3145728,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on column public.user_profiles.whatsapp_same_as_mobile is 'Explizite Bestätigung, ob WhatsApp- und Mobilnummer identisch sind.';
comment on table public.customer_appointments is 'CRM- und Google-Kalender-Termine eines vertraglich aktivierten Kunden.';
