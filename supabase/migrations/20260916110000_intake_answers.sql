alter table public.leads add column if not exists intake_answers jsonb;
comment on column public.leads.intake_answers is 'Versioned intake answer snapshot, independent of sales conversation answers';
