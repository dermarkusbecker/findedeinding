create table if not exists public.contract_number_counters (
  contract_year integer primary key check (contract_year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

insert into public.contract_number_counters (contract_year, last_value)
select
  substring(contract_number from '^FDD-([0-9]{4})-')::integer,
  max(substring(contract_number from '^FDD-[0-9]{4}-([0-9]+)$')::bigint)
from public.lead_contracts
where contract_number ~ '^FDD-[0-9]{4}-[0-9]+$'
group by substring(contract_number from '^FDD-([0-9]{4})-')::integer
on conflict (contract_year) do update
set last_value = greatest(public.contract_number_counters.last_value, excluded.last_value),
    updated_at = now();

create or replace function public.next_contract_number(p_contract_date date default current_date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(p_contract_date, current_date))::integer;
  v_number bigint;
begin
  insert into public.contract_number_counters (contract_year, last_value)
  values (v_year, 1)
  on conflict (contract_year) do update
  set last_value = public.contract_number_counters.last_value + 1,
      updated_at = now()
  returning last_value into v_number;

  return format('FDD-%s-%s', v_year, lpad(v_number::text, 4, '0'));
end;
$$;

create or replace function public.assign_contract_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contract_number is null or btrim(new.contract_number) = '' then
    new.contract_number := public.next_contract_number(coalesce(new.created_at::date, current_date));
  end if;
  return new;
end;
$$;

update public.lead_contracts
set contract_number = public.next_contract_number(coalesce(created_at::date, current_date))
where contract_number is null or btrim(contract_number) = '';

drop trigger if exists lead_contracts_assign_contract_number on public.lead_contracts;
create trigger lead_contracts_assign_contract_number
before insert on public.lead_contracts
for each row execute function public.assign_contract_number();

create unique index if not exists lead_contracts_contract_number_unique
  on public.lead_contracts(contract_number)
  where contract_number is not null;

alter table public.contract_number_counters enable row level security;
revoke all on table public.contract_number_counters from anon, authenticated;
revoke all on function public.next_contract_number(date) from public, anon, authenticated;
revoke all on function public.assign_contract_number() from public, anon, authenticated;
grant execute on function public.next_contract_number(date) to service_role;

comment on column public.lead_contracts.contract_number is
  'Automatisch und eindeutig vergebene Vertragsnummer im Schema FDD-JJJJ-NNNN.';

comment on function public.next_contract_number(date) is
  'Reserviert atomar die nächste jahresbezogene Vertragsnummer im Schema FDD-JJJJ-NNNN.';
