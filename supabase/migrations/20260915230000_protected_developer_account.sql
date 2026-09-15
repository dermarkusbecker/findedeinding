alter table public.user_profiles add column if not exists protected_developer boolean not null default false;

create or replace function public.guard_protected_developer_account()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.protected_developer then
    if TG_OP = 'DELETE' then
      raise exception 'Der geschützte Entwicklerzugang kann nicht gelöscht werden.';
    end if;
    if not new.protected_developer or new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.staff_role is distinct from old.staff_role
      or new.staff_permissions is distinct from old.staff_permissions
      or new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'Schutz, Status und Administratorrechte des Entwicklerzugangs dürfen nicht geändert werden.';
    end if;
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists guard_protected_developer_account on public.user_profiles;
create trigger guard_protected_developer_account before update or delete on public.user_profiles
for each row execute function public.guard_protected_developer_account();
