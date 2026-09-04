alter table public.lead_contracts
  add column if not exists document_confirmed_at timestamptz,
  add column if not exists video_contract_confirmed_at timestamptz,
  add column if not exists program_start_date date;

comment on column public.lead_contracts.document_confirmed_at is 'Admin-Bestätigung, dass das vollständige Vertragsdokument unterzeichnet vorliegt.';
comment on column public.lead_contracts.video_contract_confirmed_at is 'Admin-Bestätigung, dass der Videovertrag vollständig durchgeführt wurde.';
comment on column public.leads.converted_user_profile_id is 'Wird erst nach unterschriebenem Vertrag plus Vertragsdokument- und Videovertragsbestätigung gesetzt.';
