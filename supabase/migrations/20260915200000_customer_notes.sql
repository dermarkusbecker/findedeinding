create table public.customer_notes (
 id uuid primary key default gen_random_uuid(),
 user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
 title text not null,
 body text not null default '',
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index customer_notes_customer_idx on public.customer_notes(user_profile_id,updated_at desc);
alter table public.customer_notes enable row level security;
