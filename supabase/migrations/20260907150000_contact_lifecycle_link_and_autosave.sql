alter table public.user_profiles
  add column if not exists source_lead_id uuid references public.leads(id) on delete set null;

update public.user_profiles as profile
set source_lead_id = lead.id
from public.leads as lead
where lead.converted_user_profile_id = profile.id
  and profile.source_lead_id is distinct from lead.id;

create unique index if not exists user_profiles_source_lead_unique
  on public.user_profiles(source_lead_id)
  where source_lead_id is not null;

create unique index if not exists leads_converted_profile_unique
  on public.leads(converted_user_profile_id)
  where converted_user_profile_id is not null;

comment on column public.user_profiles.source_lead_id is
  'Feste 1:1-Lebenszyklus-Verknüpfung zur ursprünglichen Interessentenakte.';
