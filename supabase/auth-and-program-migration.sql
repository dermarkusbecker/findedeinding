-- FDD: zentraler Login, Rollen/Berechtigungen und 8-Wochen-Programmsteuerung
-- Idempotent. Einmal vollständig im Supabase SQL Editor ausführen.

alter table public.user_profiles add column if not exists auth_user_id uuid;
alter table public.user_profiles add column if not exists permissions text[] not null default '{}'::text[];
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles drop constraint if exists user_profiles_status_check;

update public.user_profiles
set permissions = array['customer_portal','clara_program','documents']::text[]
where role in ('participant','coach') and coalesce(array_length(permissions, 1), 0) = 0;

update public.user_profiles set role = 'user' where role in ('participant','coach');
update public.user_profiles set status = 'inactive' where status in ('paused','completed');
update public.user_profiles set status = 'active' where status = 'invited';

alter table public.user_profiles alter column role set default 'user';
alter table public.user_profiles alter column status set default 'active';
alter table public.user_profiles add constraint user_profiles_role_check check (role in ('admin','user'));
alter table public.user_profiles add constraint user_profiles_status_check check (status in ('active','inactive'));

create unique index if not exists user_profiles_auth_user_id_unique
  on public.user_profiles(auth_user_id) where auth_user_id is not null;

do $$ begin
  alter table public.user_profiles add constraint user_profiles_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users(id) on delete cascade;
exception when duplicate_object then null;
end $$;

alter table public.participant_progress
  add column if not exists program_start_date date not null default current_date,
  add column if not exists access_mode text not null default 'completion_based',
  add column if not exists program_status text not null default 'active',
  add column if not exists manually_unlocked_weeks integer[] not null default '{}'::integer[],
  add column if not exists manually_locked_weeks integer[] not null default '{}'::integer[];

update public.participant_progress set access_mode = 'completion_based' where access_mode is null;
update public.participant_progress set program_status = 'active' where program_status is null;

alter table public.participant_progress drop constraint if exists participant_progress_access_mode_check;
alter table public.participant_progress drop constraint if exists participant_progress_program_status_check;
alter table public.participant_progress add constraint participant_progress_access_mode_check check (access_mode in ('completion_based','time_based','full_access'));
alter table public.participant_progress add constraint participant_progress_program_status_check check (program_status in ('active','paused'));

create unique index if not exists participant_progress_user_profile_unique
  on public.participant_progress(user_profile_id);
