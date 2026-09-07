alter table public.participant_documents drop constraint if exists participant_documents_document_type_check;
alter table public.participant_documents
  add constraint participant_documents_document_type_check
  check (document_type in ('privacy_consent','start_commitment','cv','workbook','other','contract','video_contract','shared'));

comment on column public.participant_documents.participant_confirmed_at is
  'Zeitpunkt, zu dem der Teilnehmer ein Dokument oder eine Einwilligung im Portal aktiv bestätigt hat.';
