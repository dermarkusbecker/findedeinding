-- Explicitly approved one-time cleanup before the live customer registration starts.
-- Only customer accounts (role = user) and their 1:1 source leads are removed.
-- Internal admin/staff accounts and unrelated prospects remain untouched.
do $$
declare
  customer_profile_ids uuid[] := array[]::uuid[];
  customer_auth_ids uuid[] := array[]::uuid[];
  source_lead_ids uuid[] := array[]::uuid[];
begin
  select
    coalesce(array_agg(profile.id), array[]::uuid[]),
    coalesce(array_agg(profile.auth_user_id) filter (where profile.auth_user_id is not null), array[]::uuid[]),
    coalesce(array_agg(profile.source_lead_id) filter (where profile.source_lead_id is not null), array[]::uuid[])
  into customer_profile_ids, customer_auth_ids, source_lead_ids
  from public.user_profiles profile
  where profile.role = 'user';

  -- Remove only prospects that were converted into one of these customers.
  delete from public.leads lead
  where lead.id = any(source_lead_ids)
     or lead.converted_user_profile_id = any(customer_profile_ids);

  -- Auth deletion cascades through the linked profile and customer-domain tables.
  delete from auth.users auth_user
  where auth_user.id = any(customer_auth_ids);

  -- Covers legacy customer profiles that predate Auth linkage.
  delete from public.user_profiles profile
  where profile.id = any(customer_profile_ids);

  if exists (select 1 from public.user_profiles where role = 'user') then
    raise exception 'Customer cleanup incomplete: customer profiles remain.';
  end if;
  if exists (select 1 from auth.users where id = any(customer_auth_ids)) then
    raise exception 'Customer cleanup incomplete: linked Auth users remain.';
  end if;
  if exists (select 1 from public.leads where id = any(source_lead_ids)) then
    raise exception 'Customer cleanup incomplete: converted source leads remain.';
  end if;
end
$$;
