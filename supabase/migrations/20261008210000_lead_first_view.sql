alter table public.leads
  add column if not exists admin_first_viewed_at timestamptz;

-- Bereits vorhandene Akten wurden vor Einführung dieses Zählers bearbeitet.
update public.leads set admin_first_viewed_at=now() where admin_first_viewed_at is null;

create index if not exists leads_unviewed_idx
  on public.leads (created_at desc)
  where admin_first_viewed_at is null and converted_user_profile_id is null;
