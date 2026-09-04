create table if not exists public.clarity_questions (
  question_key text primary key,
  week integer not null check (week between 1 and 8),
  step_id text not null,
  title text not null,
  prompt_text text not null check (char_length(prompt_text) between 5 and 2000),
  default_prompt_text text not null check (char_length(default_prompt_text) between 5 and 2000),
  prompt_type text not null default 'dialog',
  sort_order integer not null default 0,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  unique (week, step_id)
);

alter table public.clarity_questions enable row level security;
create index if not exists clarity_questions_week_order_idx on public.clarity_questions(week, sort_order);

comment on table public.clarity_questions is 'Admin-editierbare Fragen und Anweisungen des FDD-Klarheitsprozesses.';
comment on column public.clarity_questions.default_prompt_text is 'Unveränderter Auslieferungsstandard für die Zurücksetzen-Funktion.';
