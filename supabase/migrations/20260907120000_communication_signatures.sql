create table if not exists public.system_branding (
  id text primary key default 'default',
  brand_name text not null default 'Finde dein Ding',
  logo_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_signatures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  closing_text text not null default 'Herzliche Grüße',
  signer_name text not null,
  role_title text,
  company_name text,
  email text,
  phone text,
  website text,
  use_system_logo boolean not null default true,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lead_communications add column if not exists signature_id uuid references public.communication_signatures(id) on delete set null;
alter table public.system_branding enable row level security;
alter table public.communication_signatures enable row level security;

create unique index if not exists communication_signatures_one_default_idx on public.communication_signatures(is_default) where is_default;
create index if not exists communication_signatures_active_idx on public.communication_signatures(active, name);

insert into public.system_branding (id, brand_name, logo_url)
values ('default', 'Finde dein Ding', '/assets/fdd-logo.svg')
on conflict (id) do nothing;

insert into public.communication_signatures (name, closing_text, signer_name, role_title, company_name, email, website, use_system_logo, active, is_default)
select 'Markus Becker · Persönlich', 'Herzliche Grüße', 'Markus Becker', 'Gründer & Klarheitsbegleiter', 'Finde dein Ding', 'markus@findedeinding.de', 'findedeinding.de', true, true, true
where not exists (select 1 from public.communication_signatures where signer_name = 'Markus Becker');

insert into public.communication_automations (name, trigger_type, trigger_config, delay_value, delay_unit, template_id, audience_type, enabled)
select 'Portal-Zugang nach Vertragsabschluss', 'participant_activated', '{}'::jsonb, 0, 'minutes', template.id, 'event_contact', true
from public.communication_templates template
where template.template_key = 'participant_access'
  and not exists (select 1 from public.communication_automations where name = 'Portal-Zugang nach Vertragsabschluss');

update public.communication_templates
set subject = 'Dein Finde-dein-Ding-Zugang ist bereit, {{vorname}}',
    body = E'Hallo {{vorname}},\n\njetzt wird es konkret: Dein persönlicher Bereich bei Finde dein Ding ist startklar.\n\nDein Benutzername: {{login_name}}\n\nÜber diesen sicheren Link vergibst du dein persönliches Passwort und startest anschließend direkt in „Mein Bereich“:\n{{login_link}}\n\nWichtig: Der Link ist nur für dich bestimmt. Beim ersten Login legst du dein eigenes Passwort fest.\n\nSchön, dass du da bist – wir freuen uns auf deinen Weg.\n\nHerzliche Grüße\nMarkus Becker\nFinde dein Ding',
    status = 'active',
    updated_at = now()
where template_key = 'participant_access';

comment on table public.communication_signatures is 'Editierbare Absendersignaturen für CRM-Nachrichten.';
comment on table public.system_branding is 'Globale Marke und Logoquelle für CRM, Signaturen und Systemkommunikation.';
