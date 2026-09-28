alter table public.leads
  add column if not exists street_name text,
  add column if not exists house_number text,
  add column if not exists postal_code text,
  add column if not exists city text;

comment on column public.leads.street_name is 'Straße aus Kontakt, separat von der Hausnummer erfasst.';
comment on column public.leads.house_number is 'Hausnummer aus Kontakt.';
comment on column public.leads.postal_code is 'Postleitzahl aus Kontakt.';
comment on column public.leads.city is 'Ort aus Kontakt.';
