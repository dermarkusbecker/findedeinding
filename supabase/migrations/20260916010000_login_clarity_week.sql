alter table public.login_clarity_checkins add column week integer;
create or replace function public.assign_login_clarity_week() returns trigger language plpgsql set search_path=public as $$
begin
 select greatest(1,least(8,current_week)) into new.week from participant_progress where user_profile_id=new.user_profile_id limit 1;
 new.week:=coalesce(new.week,1);return new;
end $$;
create trigger assign_login_clarity_week before insert on public.login_clarity_checkins for each row execute function public.assign_login_clarity_week();
