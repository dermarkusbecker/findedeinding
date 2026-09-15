create table public.login_clarity_checkins (
 id uuid primary key default gen_random_uuid(),
 user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
 session_key text not null, score integer not null check(score between 1 and 10),
 note text not null default '', created_at timestamptz not null default now(),
 unique(user_profile_id,session_key)
);
alter table public.login_clarity_checkins enable row level security;
create or replace function public.save_login_clarity(p_user uuid,p_session text,p_score integer,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous integer; saved public.login_clarity_checkins; begin
 perform pg_advisory_xact_lock(hashtext(p_user::text));
 select * into saved from login_clarity_checkins where user_profile_id=p_user and session_key=p_session;
 if found then return to_jsonb(saved); end if;
 select score into previous from login_clarity_checkins where user_profile_id=p_user order by created_at desc limit 1;
 if p_score<previous and length(trim(coalesce(p_note,'')))=0 then raise exception 'Bitte beschreibe kurz, warum deine Klarheit heute niedriger ist.'; end if;
 insert into login_clarity_checkins(user_profile_id,session_key,score,note) values(p_user,p_session,p_score,left(trim(coalesce(p_note,'')),3000)) returning * into saved;
 if p_score<previous then
 insert into customer_questions(user_profile_id,week,question) values(p_user,1,'[Klarheits-Nachgespräch für Markus] Login-Check-in: '||previous||' → '||p_score||'/10. '||saved.note);
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.save_login_clarity(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.save_login_clarity(uuid,text,integer,text) to service_role;
