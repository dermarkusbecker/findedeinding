create table if not exists public.lead_contract_recording_consents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  contract_id uuid not null references public.lead_contracts(id) on delete cascade,
  staff_profile_id uuid references public.user_profiles(id) on delete set null,
  staff_name text not null,
  consented_at timestamptz not null default now(),
  recording_consent boolean not null check (recording_consent),
  documentation_purpose_confirmed boolean not null check (documentation_purpose_confirmed),
  future_revocation_explained boolean not null check (future_revocation_explained)
);

create index if not exists lead_contract_recording_consents_contract_idx
  on public.lead_contract_recording_consents(contract_id, consented_at desc);

alter table public.lead_contract_recording_consents enable row level security;

alter table public.lead_contracts
  add column if not exists document_prepared_at timestamptz,
  add column if not exists video_recording_consent_record_id uuid references public.lead_contract_recording_consents(id),
  add column if not exists video_recording_consent_staff_name text;

alter table public.lead_communications
  add column if not exists recipient_email text,
  add column if not exists sent_by_profile_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists sent_by_name text;

comment on table public.lead_contract_recording_consents is
  'Protokoll der drei Pflichtbestätigungen vor einer Vertragsaufzeichnung mit Zeit und verantwortlichem Mitarbeiter.';
