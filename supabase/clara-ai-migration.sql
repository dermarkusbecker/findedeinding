-- Versionierbare Clara-KI-Persistenz. Originalaussagen bleiben zusätzlich in process_entries erhalten.
create table if not exists public.clara_messages (
  id uuid primary key default gen_random_uuid(), user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  week integer not null check (week between 1 and 8), role text not null check (role in ('participant','assistant')), content text not null,
  client_message_id text, source_entry_id uuid references public.process_entries(id) on delete set null,
  model text, model_response_id text, prompt_version text not null, schema_version text not null,
  structured_response jsonb, accepted_state_updates jsonb not null default '[]'::jsonb, rejected_state_updates jsonb not null default '[]'::jsonb,
  token_usage jsonb, created_at timestamptz not null default now()
);
create unique index if not exists clara_messages_client_message_unique on public.clara_messages(user_profile_id, client_message_id) where client_message_id is not null and role = 'participant';
create index if not exists clara_messages_participant_idx on public.clara_messages(user_profile_id, week, created_at desc);

create table if not exists public.participant_memory (
  id uuid primary key default gen_random_uuid(), user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  memory_type text not null check (memory_type in ('structured_fact','recurring_theme','tension','insight','open_question','preference','career_station')),
  topic text not null, value text not null, source_entry_id uuid references public.process_entries(id) on delete set null,
  source_message_id uuid references public.clara_messages(id) on delete set null, source_week integer not null check (source_week between 1 and 8),
  confidence numeric(4,3) not null check (confidence between 0 and 1), status text not null default 'active' check (status in ('active','superseded','rejected')),
  supersedes_memory_id uuid references public.participant_memory(id) on delete set null, memory_version integer not null default 1,
  extractor_version text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists participant_memory_lookup_idx on public.participant_memory(user_profile_id, status, topic, created_at desc);

create table if not exists public.participant_documents (
  id uuid primary key default gen_random_uuid(), user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  week integer not null check (week between 0 and 8), document_type text not null check (document_type in ('start_commitment','cv','workbook','other')),
  original_file_name text not null, mime_type text not null, byte_size bigint not null check (byte_size > 0),
  storage_bucket text not null, storage_path text not null unique, sha256 text,
  processing_status text not null default 'uploaded' check (processing_status in ('uploaded','extracting','needs_ocr','ready','failed')),
  extraction_method text check (extraction_method in ('pdf_text','docx_text','ocr','manual')), extracted_text text,
  extracted_data jsonb not null default '{}'::jsonb, extraction_version text, participant_confirmed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists participant_documents_lookup_idx on public.participant_documents(user_profile_id, week, created_at desc);

alter table public.clara_messages enable row level security;
alter table public.participant_memory enable row level security;
alter table public.participant_documents enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('participant-documents','participant-documents',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
