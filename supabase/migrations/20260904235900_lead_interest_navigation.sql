-- Ergänzt die vertriebliche Ablage „Später Interesse“ für die Interessenten-Navigation.
alter table public.leads drop constraint if exists leads_status_check;

alter table public.leads add constraint leads_status_check
  check (status in ('new','contacted','scheduled','consultation','offer','later','customer','lost'));

comment on column public.leads.status is
  'Vertriebsstatus: aktive Bearbeitung, späteres Interesse, kein Interesse oder konvertierter Kunde.';
