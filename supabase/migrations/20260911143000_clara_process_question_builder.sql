alter table public.clarity_questions
  add column if not exists guidance_text text not null default '',
  add column if not exists default_guidance_text text not null default '',
  add column if not exists completion_criteria text not null default '',
  add column if not exists default_completion_criteria text not null default '';

alter table public.clarity_questions
  drop constraint if exists clarity_questions_guidance_text_check,
  add constraint clarity_questions_guidance_text_check check (char_length(guidance_text) <= 4000),
  drop constraint if exists clarity_questions_default_guidance_text_check,
  add constraint clarity_questions_default_guidance_text_check check (char_length(default_guidance_text) <= 4000),
  drop constraint if exists clarity_questions_completion_criteria_check,
  add constraint clarity_questions_completion_criteria_check check (char_length(completion_criteria) <= 4000),
  drop constraint if exists clarity_questions_default_completion_criteria_check,
  add constraint clarity_questions_default_completion_criteria_check check (char_length(default_completion_criteria) <= 4000);

comment on column public.clarity_questions.guidance_text is 'Admin-editierbare Detailanweisung, an die Clara beim aktuellen Schritt gebunden ist.';
comment on column public.clarity_questions.completion_criteria is 'Admin-editierbare Kriterien, anhand derer Clara offene Rückfragen und die Übergabereife beurteilt.';
