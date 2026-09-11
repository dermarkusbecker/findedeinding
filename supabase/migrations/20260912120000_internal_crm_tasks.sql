alter table public.lead_tasks alter column lead_id drop not null;
comment on column public.lead_tasks.lead_id is 'Zugeordneter Interessent/Kunde; NULL nur für interne CRM-Aufgaben.';
