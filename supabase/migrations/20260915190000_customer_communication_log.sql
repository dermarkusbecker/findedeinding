alter table public.lead_communications alter column lead_id drop not null;
alter table public.lead_communications add column if not exists user_profile_id uuid references public.user_profiles(id) on delete cascade;
alter table public.lead_communications add column if not exists attachments jsonb not null default '[]'::jsonb;
create index if not exists lead_communications_customer_idx on public.lead_communications(user_profile_id,occurred_at desc);
