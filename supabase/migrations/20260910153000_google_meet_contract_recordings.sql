alter table public.integration_settings
  add column if not exists granted_scopes text[] not null default '{}'::text[];

alter table public.lead_contracts
  add column if not exists video_recording_provider text,
  add column if not exists google_meet_conference_record text,
  add column if not exists google_meet_recording_name text,
  add column if not exists google_drive_file_id text,
  add column if not exists google_drive_export_uri text,
  add column if not exists google_meet_recording_state text,
  add column if not exists video_recording_imported_at timestamptz;

comment on column public.integration_settings.granted_scopes is
  'Die bei der letzten OAuth-Freigabe tatsächlich von Google gewährten Berechtigungen.';
comment on column public.lead_contracts.video_recording_provider is
  'Quelle der Vertragsaufzeichnung. Für den Live-Ablauf wird google_meet verwendet.';
comment on column public.lead_contracts.video_recording_path is
  'Privater Storage-Pfad der vollständig aus Google Meet/Drive übernommenen Vertragsaufzeichnung.';
comment on column public.lead_contracts.google_meet_recording_name is
  'Eindeutiger Ressourcenname der nativen Google-Meet-Aufzeichnung.';
comment on column public.lead_contracts.google_drive_file_id is
  'Google-Drive-Datei-ID der von Meet erzeugten MP4-Quelldatei.';
comment on column public.lead_contracts.video_recording_imported_at is
  'Zeitpunkt, an dem die Meet-MP4 vollständig in den privaten CRM-Speicher übernommen wurde.';
