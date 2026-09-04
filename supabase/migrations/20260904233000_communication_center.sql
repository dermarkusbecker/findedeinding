create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique,
  name text not null,
  description text,
  category text not null default 'general' check (category in ('general', 'lead', 'appointment', 'contract', 'participant', 'program')),
  channel text not null default 'email' check (channel in ('email', 'whatsapp')),
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_id uuid references public.communication_templates(id) on delete set null,
  audience_type text not null default 'leads' check (audience_type in ('all', 'leads', 'customers', 'selected')),
  audience_filter jsonb not null default '{}'::jsonb,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  subject text not null,
  body text not null,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'paused', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger_type text not null check (trigger_type in ('lead_created', 'appointment_scheduled', 'contract_signed', 'participant_activated', 'week_unlocked', 'inactivity')),
  trigger_config jsonb not null default '{}'::jsonb,
  delay_value integer not null default 0 check (delay_value between 0 and 365),
  delay_unit text not null default 'hours' check (delay_unit in ('minutes', 'hours', 'days')),
  send_time time,
  template_id uuid not null references public.communication_templates(id) on delete restrict,
  audience_type text not null default 'event_contact' check (audience_type in ('event_contact', 'leads', 'customers')),
  enabled boolean not null default false,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.communication_templates enable row level security;
alter table public.communication_campaigns enable row level security;
alter table public.communication_automations enable row level security;

create index if not exists communication_templates_status_idx on public.communication_templates(status, category, updated_at desc);
create index if not exists communication_campaigns_schedule_idx on public.communication_campaigns(status, scheduled_at);
create index if not exists communication_automations_trigger_idx on public.communication_automations(enabled, trigger_type);

insert into public.communication_templates (template_key, name, description, category, channel, subject, body, status)
values
  ('appointment_reminder', 'Terminerinnerung', 'Erinnerung vor einem bestätigten Beratungs- oder Ersttermin.', 'appointment', 'email', 'Erinnerung an deinen Termin am {{termin}}', E'Hallo {{vorname}},\n\nwir erinnern dich an deinen Termin am {{datum}} um {{uhrzeit}} Uhr.\n\nHier kannst du teilnehmen: {{meet_link}}\n\nHerzliche Grüße\nDein Finde-dein-Ding-Team', 'active'),
  ('welcome_lead', 'Willkommensnachricht', 'Persönlicher Einstieg nach der ersten Kontaktaufnahme.', 'lead', 'email', 'Willkommen bei Finde dein Ding, {{vorname}}', E'Hallo {{vorname}},\n\nvielen Dank für dein Interesse. Wir freuen uns darauf, dich und deine aktuelle Situation kennenzulernen.\n\nHerzliche Grüße\nDein Finde-dein-Ding-Team', 'active'),
  ('appointment_preparation', 'Vorbereitung Erstgespräch', 'Unterlagen und Hinweise vor dem Kundengespräch.', 'appointment', 'email', 'Deine Vorbereitung auf unser Gespräch', E'Hallo {{vorname}},\n\nfür unser Gespräch am {{datum}} findest du hier alle wichtigen Informationen. Bitte plane etwa {{dauer}} Minuten ein.\n\nHerzliche Grüße\nDein Finde-dein-Ding-Team', 'draft'),
  ('contract_completed', 'Vertrag abgeschlossen', 'Bestätigung nach vollständigem Vertrags- und Videoabschluss.', 'contract', 'email', 'Dein Vertrag ist vollständig abgeschlossen', E'Hallo {{vorname}},\n\ndein Vertragsabschluss ist vollständig bestätigt. Als Nächstes richten wir deinen Teilnehmerzugang ein.\n\nHerzliche Grüße\nDein Finde-dein-Ding-Team', 'active'),
  ('participant_access', 'Teilnehmer-Zugang', 'Zugangsdaten nach erfolgreichem Vertragsabschluss.', 'participant', 'email', 'Dein persönlicher Teilnehmer-Zugang', E'Hallo {{vorname}},\n\ndein Teilnehmerkonto ist bereit. Dein Benutzername lautet {{login_name}}. Über den sicheren Link vergibst du dein persönliches Passwort.\n\n{{login_link}}', 'active'),
  ('week_unlocked', 'Neue Woche freigeschaltet', 'Information zur automatischen Freischaltung einer Programmwoche.', 'program', 'email', 'Woche {{woche}} ist jetzt für dich geöffnet', E'Hallo {{vorname}},\n\ndeine nächste Programmwoche ist jetzt freigeschaltet. Dich erwartet: {{wochen_titel}}.\n\nZum Programm: {{portal_link}}', 'draft'),
  ('friendly_reminder', 'Freundliche Erinnerung', 'Hinweis auf einen noch nicht abgeschlossenen Prozessschritt.', 'program', 'email', 'Ein kleiner Impuls für deinen nächsten Schritt', E'Hallo {{vorname}},\n\nin deinem Prozess ist noch ein Schritt offen. Nimm dir kurz Zeit, um dort weiterzumachen, wo du aufgehört hast.\n\nZum Programm: {{portal_link}}', 'draft')
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  channel = excluded.channel,
  subject = excluded.subject,
  body = excluded.body,
  updated_at = now();

comment on table public.communication_templates is 'Wiederverwendbare Nachrichteninhalte mit CRM-Platzhaltern.';
comment on table public.communication_campaigns is 'Selektierte Seriennachrichten mit Entwurfs- und Zeitplanstatus.';
comment on table public.communication_automations is 'Ereignis- und zeitgesteuerte Kommunikationsregeln; Versand setzt eine aktive Mail-Schnittstelle voraus.';
