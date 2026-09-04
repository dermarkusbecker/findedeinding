create table if not exists public.gate_week_settings (
  week integer primary key check (week between 0 and 8),
  title text not null check (char_length(title) between 2 and 120),
  description text not null check (char_length(description) between 5 and 600),
  default_title text not null,
  default_description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null
);

create table if not exists public.gate_template_settings (
  gate_key text primary key,
  week integer not null references public.gate_week_settings(week) on delete cascade,
  label text not null check (char_length(label) between 2 and 240),
  default_label text not null,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  unique (week, sort_order)
);

alter table public.gate_week_settings enable row level security;
alter table public.gate_template_settings enable row level security;
create index if not exists gate_template_settings_week_order_idx on public.gate_template_settings(week, sort_order);

insert into public.gate_week_settings (week, title, description, default_title, default_description) values
  (0, 'Onboarding', 'Datenschutz und Start-Commitment schaffen die verbindliche Grundlage für den Programmstart.', 'Onboarding', 'Datenschutz und Start-Commitment schaffen die verbindliche Grundlage für den Programmstart.'),
  (1, 'Ausgangslage', 'Wünsche, Zielbild, Klarheits-Baseline und bisheriger Werdegang sind vollständig erfasst.', 'Ausgangslage', 'Wünsche, Zielbild, Klarheits-Baseline und bisheriger Werdegang sind vollständig erfasst.'),
  (2, 'Fähigkeiten & Umfeld', 'Formales und informelles Können sowie Selbstbild, Fremdbild und aktuelles Ziel sind dokumentiert.', 'Fähigkeiten & Umfeld', 'Formales und informelles Können sowie Selbstbild, Fremdbild und aktuelles Ziel sind dokumentiert.'),
  (3, 'Motivatoren', 'Die wichtigsten Motivatoren und frühen Interessen sind priorisiert und in die Gegenwart übersetzt.', 'Motivatoren', 'Die wichtigsten Motivatoren und frühen Interessen sind priorisiert und in die Gegenwart übersetzt.'),
  (4, 'Halbzeit', 'Human Design, Ding-Leben-Zuordnung und Halbzeitbericht sind technisch und fachlich abgeschlossen.', 'Halbzeit', 'Human Design, Ding-Leben-Zuordnung und Halbzeitbericht sind technisch und fachlich abgeschlossen.'),
  (5, 'Werte & Lebenswerk', 'Werte, LILA und die persönliche Grabrede verdichten das langfristig Bedeutsame.', 'Werte & Lebenswerk', 'Werte, LILA und die persönliche Grabrede verdichten das langfristig Bedeutsame.'),
  (6, 'Dein-Ding-Map', 'Die vier Bereiche sowie Ausschluss- und Positivkriterien sind in der Dein-Ding-Map verbunden.', 'Dein-Ding-Map', 'Die vier Bereiche sowie Ausschluss- und Positivkriterien sind in der Dein-Ding-Map verbunden.'),
  (7, 'Optionen & Realität', 'Realitätskontakt und zwei finale Optionen führen zu einer Entscheidung oder Coach-Eskalation.', 'Optionen & Realität', 'Realitätskontakt und zwei finale Optionen führen zu einer Entscheidung oder Coach-Eskalation.'),
  (8, 'Umsetzung', 'Entscheidung, Umsetzungsplan, Commitment, Dossier und Abschlusscall sind vollständig vorbereitet.', 'Umsetzung', 'Entscheidung, Umsetzungsplan, Commitment, Dossier und Abschlusscall sind vollständig vorbereitet.')
on conflict (week) do nothing;

insert into public.gate_template_settings (gate_key, week, label, default_label, sort_order) values
  ('privacy_consent', 0, 'Datenschutz aktiv bestätigt', 'Datenschutz aktiv bestätigt', 1),
  ('start_commitment', 0, 'Start-Commitment unterschrieben', 'Start-Commitment unterschrieben', 2),
  ('three_wishes', 1, 'Drei Wünsche vertieft', 'Drei Wünsche vertieft', 1),
  ('target_and_baseline', 1, 'Zielzustand und Klarheits-Baseline', 'Zielzustand und Klarheits-Baseline', 2),
  ('career_history', 1, 'Werdegang vollständig', 'Werdegang vollständig', 3),
  ('skills', 2, 'Formales und informelles Können', 'Formales und informelles Können', 1),
  ('self_external_view', 2, 'Selbst- und Fremdbild', 'Selbst- und Fremdbild', 2),
  ('current_goal', 2, 'Aktuelles Ziel', 'Aktuelles Ziel', 3),
  ('motivators', 3, 'Top 5 Motivatoren', 'Top 5 Motivatoren', 1),
  ('childhood', 3, 'Kindheitsinteressen', 'Kindheitsinteressen', 2),
  ('reintegration', 3, 'Reintegration gewählt', 'Reintegration gewählt', 3),
  ('human_design', 4, 'Human Design technisch verarbeitet', 'Human Design technisch verarbeitet', 1),
  ('puzzle_assignment', 4, 'Ding/Leben-Zuordnung', 'Ding/Leben-Zuordnung', 2),
  ('midpoint_report', 4, 'Halbzeitbericht erzeugt', 'Halbzeitbericht erzeugt', 3),
  ('values', 5, 'Top 5 Werte', 'Top 5 Werte', 1),
  ('lila', 5, 'LILA abgeschlossen', 'LILA abgeschlossen', 2),
  ('eulogy', 5, 'Grabrede hochgeladen', 'Grabrede hochgeladen', 3),
  ('four_areas', 6, 'Vier FDD-Bereiche', 'Vier FDD-Bereiche', 1),
  ('exclusion_criteria', 6, 'Mindestens 10 Ausschlusskriterien', 'Mindestens 10 Ausschlusskriterien', 2),
  ('ding_map', 6, 'Positivkriterien und Dein-Ding-Map', 'Positivkriterien und Dein-Ding-Map', 3),
  ('reality_contact', 7, 'Mindestens ein Realitätskontakt', 'Mindestens ein Realitätskontakt', 1),
  ('final_two', 7, 'Genau zwei Optionen', 'Genau zwei Optionen', 2),
  ('decision_or_escalation', 7, 'Entscheidung oder Coach-Eskalation', 'Entscheidung oder Coach-Eskalation', 3),
  ('implementation_plan', 8, '24/30/90-Tage-Plan', '24/30/90-Tage-Plan', 1),
  ('final_commitment', 8, 'Umsetzungs-Commitment', 'Umsetzungs-Commitment', 2),
  ('dossier_and_call', 8, 'Dossier und Abschlusscall', 'Dossier und Abschlusscall', 3)
on conflict (gate_key) do nothing;

create or replace function public.apply_gate_template_label()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  configured_label text;
begin
  select label into configured_label
  from public.gate_template_settings
  where gate_key = new.gate_key and week = new.week;
  new.label := coalesce(configured_label, new.label);
  return new;
end;
$$;

drop trigger if exists apply_gate_template_label_before_insert on public.week_gates;
create trigger apply_gate_template_label_before_insert
before insert on public.week_gates
for each row execute function public.apply_gate_template_label();

comment on table public.gate_week_settings is 'Admin-editierbare Titel und Beschreibungen der Wochen-Gates.';
comment on table public.gate_template_settings is 'Admin-editierbare Bezeichnungen der fachlich fest verdrahteten Gate-Felder.';
