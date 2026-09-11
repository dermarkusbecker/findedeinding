create or replace function public.program_week_is_released(
  participant_id uuid,
  target_week integer
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_week <= 0 then true
    else coalesce(
      (
        select profile.status = 'active'
          and progress.program_status = 'active'
          and progress.privacy_consent_at is not null
          and progress.start_commitment_at is not null
          and (
            'demo_full_access' = any(profile.permissions)
            or (now() at time zone 'Europe/Berlin')::date
              >= progress.program_start_date + ((target_week - 1) * 7)
          )
        from public.participant_progress as progress
        join public.user_profiles as profile
          on profile.id = progress.user_profile_id
        where progress.user_profile_id = participant_id
        limit 1
      ),
      false
    )
  end;
$$;

comment on function public.program_week_is_released(uuid, integer) is
  'Datenbankregel für zeitbasierte Wochenfreigaben; demo_full_access erlaubt ausschließlich dem markierten aktiven Demo-Konto den sequenziellen Testzugriff.';

revoke execute on function public.program_week_is_released(uuid, integer) from public, anon, authenticated;
