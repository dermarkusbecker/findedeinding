alter table public.leads
  add column if not exists mobile_phone text,
  add column if not exists whatsapp_phone text,
  add column if not exists whatsapp_same_as_mobile boolean not null default true,
  add column if not exists sales_conversation_completed_at timestamptz,
  add column if not exists appointment_confirmation_prepared_at timestamptz;

update public.leads
set mobile_phone = phone
where mobile_phone is null and phone is not null;

alter table public.booking_settings
  add column if not exists offered_durations integer[] not null default '{45}'::integer[];

update public.booking_settings
set offered_durations = array[default_duration_minutes]
where offered_durations is null or cardinality(offered_durations) = 0;

comment on column public.booking_settings.offered_durations is 'Vom Admin angebotene Daueroptionen für freie Erstgespräche.';
comment on column public.leads.appointment_confirmation_prepared_at is 'Zeitpunkt, zu dem die Terminbestätigung nach Abschluss des Verkaufsgesprächs ausgelöst wurde.';

alter table public.communication_automations
  drop constraint if exists communication_automations_trigger_type_check;
alter table public.communication_automations
  add constraint communication_automations_trigger_type_check
  check (trigger_type in ('lead_created', 'appointment_scheduled', 'sales_conversation_completed', 'contract_signed', 'participant_activated', 'week_unlocked', 'inactivity'));

insert into public.communication_templates (template_key, name, description, category, channel, subject, body, status)
values (
  'sales_conversation_appointment_confirmation',
  'Terminbestätigung nach Verkaufsgespräch',
  'Wird erst nach dem vollständigen Abschluss des Verkaufsgesprächs ausgelöst und enthält Termin sowie Google-Meet-Link.',
  'appointment',
  'email',
  'Dein Klarheitsgespräch ist bestätigt',
  E'Hallo {{vorname}},\n\ndein Klarheitsgespräch findet am {{datum}} um {{uhrzeit}} Uhr statt.\n\nHier kannst du teilnehmen: {{meet_link}}\n\nHerzliche Grüße\nMarkus Becker',
  'active'
)
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  subject = excluded.subject,
  body = excluded.body,
  status = excluded.status,
  updated_at = now();

insert into public.communication_automations (name, trigger_type, delay_value, delay_unit, template_id, audience_type, enabled)
select 'Terminbestätigung nach Verkaufsgespräch', 'sales_conversation_completed', 0, 'minutes', id, 'event_contact', true
from public.communication_templates
where template_key = 'sales_conversation_appointment_confirmation'
  and not exists (
    select 1 from public.communication_automations
    where trigger_type = 'sales_conversation_completed'
      and name = 'Terminbestätigung nach Verkaufsgespräch'
  );
