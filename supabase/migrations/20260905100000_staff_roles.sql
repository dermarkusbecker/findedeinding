alter table public.user_profiles
  add column if not exists staff_role text,
  add column if not exists staff_permissions text[] not null default '{}'::text[];

alter table public.user_profiles drop constraint if exists user_profiles_staff_role_check;
alter table public.user_profiles
  add constraint user_profiles_staff_role_check
  check (staff_role is null or staff_role in ('owner', 'administrator', 'sales', 'customer_success', 'communications', 'finance'));

update public.user_profiles
set staff_role = 'owner',
    staff_permissions = array['dashboard','customers','leads','sales_calls','program','communications','finance','settings','users']::text[]
where role = 'admin' and staff_role is null;

update public.user_profiles
set staff_role = null, staff_permissions = '{}'::text[]
where role = 'user';

comment on column public.user_profiles.staff_role is 'Interne CRM-Rolle; getrennt von Teilnehmerkonten.';
comment on column public.user_profiles.staff_permissions is 'Serverseitig wirksame CRM-Berechtigungen der zugewiesenen internen Rolle.';
