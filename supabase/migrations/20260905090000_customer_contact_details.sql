alter table public.user_profiles
  add column if not exists birth_date date,
  add column if not exists street text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists country text not null default 'Deutschland',
  add column if not exists phone text,
  add column if not exists whatsapp_phone text,
  add column if not exists preferred_communication_channel text not null default 'email',
  add column if not exists postal_mail_active boolean not null default true;

alter table public.user_profiles drop constraint if exists user_profiles_preferred_communication_channel_check;
alter table public.user_profiles
  add constraint user_profiles_preferred_communication_channel_check
  check (preferred_communication_channel in ('email', 'phone', 'whatsapp'));

update public.user_profiles profile
set phone = lead.phone
from public.leads lead
where lead.converted_user_profile_id = profile.id
  and profile.phone is null
  and lead.phone is not null;

comment on column public.user_profiles.birth_date is 'Geburtsdatum aus den Kundenstammdaten.';
comment on column public.user_profiles.street is 'Straße und Hausnummer der Kundenanschrift.';
comment on column public.user_profiles.postal_code is 'Postleitzahl der Kundenanschrift.';
comment on column public.user_profiles.city is 'Ort der Kundenanschrift.';
comment on column public.user_profiles.preferred_communication_channel is 'Vom Kunden bevorzugter Kommunikationskanal.';
comment on column public.user_profiles.postal_mail_active is 'Gibt an, ob die Postanschrift aktiv verwendet wird.';
