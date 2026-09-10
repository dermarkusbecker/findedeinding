alter table public.participant_documents
  drop constraint if exists participant_documents_extraction_method_check;

alter table public.participant_documents
  add constraint participant_documents_extraction_method_check
  check (extraction_method in ('pdf_text', 'docx_text', 'ocr', 'manual', 'pdf_form_fill'));

comment on column public.participant_documents.extraction_method is
  'Verarbeitungsart des Dokuments; pdf_form_fill kennzeichnet systemseitig befüllte und abgeflachte PDF-Formulare.';
