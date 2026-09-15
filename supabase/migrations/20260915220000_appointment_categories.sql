alter table public.booking_settings add column if not exists categories jsonb;
update public.booking_settings set categories=jsonb_build_array(jsonb_build_object('id','initial','name','Klarheitsgespräch','duration',default_duration_minutes,'active',true)) where categories is null;
alter table public.leads add column if not exists appointment_title text;
alter table public.leads add column if not exists appointment_category_id text;
