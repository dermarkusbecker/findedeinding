create sequence if not exists public.customer_number_seq start with 10001;

alter table public.user_profiles
  add column if not exists portal_username text,
  add column if not exists customer_number text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists one_time_password_issued_at timestamptz,
  add column if not exists access_invite_sent_at timestamptz,
  add column if not exists password_changed_at timestamptz;

create unique index if not exists user_profiles_customer_number_unique
  on public.user_profiles(customer_number) where customer_number is not null;

create unique index if not exists user_profiles_portal_username_lower_unique
  on public.user_profiles(lower(portal_username)) where portal_username is not null;

create or replace function public.assign_participant_login()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  first_name text;
begin
  if 'clara_program' = any(coalesce(new.permissions, '{}'::text[])) then
    if new.customer_number is null or btrim(new.customer_number) = '' then
      new.customer_number := 'KD' || lpad(nextval('public.customer_number_seq')::text, 6, '0');
    end if;
    if new.portal_username is null or btrim(new.portal_username) = '' then
      first_name := regexp_replace(split_part(btrim(new.name), ' ', 1), '[^[:alnum:]-]', '', 'g');
      if first_name = '' then first_name := 'Kunde'; end if;
      new.portal_username := first_name || '_' || new.customer_number;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_participant_login_before_write on public.user_profiles;
create trigger assign_participant_login_before_write
before insert or update of permissions, name on public.user_profiles
for each row execute function public.assign_participant_login();

update public.user_profiles
set name = name
where 'clara_program' = any(coalesce(permissions, '{}'::text[]))
  and (customer_number is null or portal_username is null);

comment on column public.user_profiles.portal_username is 'Editierbarer Teilnehmer-Login im Format Vorname_Kundennummer.';
comment on column public.user_profiles.customer_number is 'Automatisch vergebene, unveränderliche Kundennummer.';
comment on column public.user_profiles.must_change_password is 'Sperrt den Portalzugang bis ein Einmalpasswort durch ein persönliches Passwort ersetzt wurde.';
