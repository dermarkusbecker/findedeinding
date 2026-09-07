alter table public.lead_contracts
  add column if not exists contract_data jsonb not null default '{}'::jsonb,
  add column if not exists document_bucket text,
  add column if not exists document_storage_path text,
  add column if not exists document_mime_type text,
  add column if not exists video_answers jsonb not null default '{}'::jsonb,
  add column if not exists video_recording_bucket text,
  add column if not exists video_recording_path text,
  add column if not exists video_recording_mime_type text,
  add column if not exists video_recording_bytes bigint,
  add column if not exists video_recording_started_at timestamptz,
  add column if not exists video_recording_ended_at timestamptz,
  add column if not exists video_recording_consent_at timestamptz,
  add column if not exists signing_token_hash text,
  add column if not exists signing_expires_at timestamptz,
  add column if not exists customer_signed_at timestamptz,
  add column if not exists customer_signature_name text,
  add column if not exists signature_method text;

create unique index if not exists lead_contracts_signing_token_hash_unique
  on public.lead_contracts(signing_token_hash)
  where signing_token_hash is not null;

comment on column public.lead_contracts.video_recording_consent_at is
  'Zeitpunkt der vor Beginn ausdrücklich protokollierten Einwilligung in die konkrete Abschlussaufzeichnung.';
comment on column public.lead_contracts.video_recording_path is
  'Privater Storage-Pfad der vom Mitarbeiter über die Browserfreigabe aufgezeichneten Abschlusssequenz.';
comment on column public.lead_contracts.signature_method is
  'Dokumentierter Abschlussweg, z. B. video_confirmation oder customer_click_confirmation.';
