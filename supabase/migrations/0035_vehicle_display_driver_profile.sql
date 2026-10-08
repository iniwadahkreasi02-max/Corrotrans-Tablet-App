-- Expose only the approved driver's display name and Admin-assigned vehicle
-- details through the existing tablet capability. No Supabase key or user id
-- is sent to the tablet.
begin;

create or replace function public.corrotrans_vehicle_display_driver_profile(
  p_session_token_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pairing public.vehicle_display_pairings%rowtype;
  v_profile jsonb;
begin
  if p_session_token_hash is null or p_session_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'invalid');
  end if;

  select pairing.* into v_pairing
  from public.vehicle_display_pairings pairing
  where pairing.session_token_hash = p_session_token_hash
  limit 1;
  if not found then return jsonb_build_object('error', 'invalid'); end if;
  if v_pairing.revoked_at is not null then
    return jsonb_build_object('error', 'revoked');
  end if;
  if v_pairing.session_expires_at is null
     or v_pairing.session_expires_at <= pg_catalog.now() then
    return jsonb_build_object('error', 'expired');
  end if;

  select jsonb_build_object(
    'name', coalesce(nullif(pg_catalog.btrim(profile.full_name), ''), 'Driver'),
    'plate', coalesce(nullif(pg_catalog.btrim(vehicle.plate_number), ''), 'Belum tersedia'),
    'vehicleModel', coalesce(
      nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ', vehicle.make, vehicle.model)), ''),
      'Kendaraan Corrotrans'
    ),
    'photo_path', profile.photo_path,
    'photo_updated_at', profile.photo_updated_at
  ) into v_profile
  from public.vehicles vehicle
  join public.drivers driver on driver.id = vehicle.driver_id
  join public.profiles profile on profile.id = driver.user_id
  where vehicle.id = v_pairing.vehicle_id
    and vehicle.archived_at is null
    and profile.role = 'driver'
    and driver.verification_status = 'approved'
  limit 1;

  if v_profile is null then
    return jsonb_build_object('error', 'no_driver');
  end if;
  return v_profile;
end;
$$;

revoke all on function public.corrotrans_vehicle_display_driver_profile(text)
  from public, authenticated;
grant execute on function public.corrotrans_vehicle_display_driver_profile(text)
  to anon, service_role;

create or replace function public.corrotrans_vehicle_display_touch_profile_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name
     or new.photo_path is distinct from old.photo_path
     or new.photo_updated_at is distinct from old.photo_updated_at then
    perform public.corrotrans_vehicle_display_touch_driver(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists corrotrans_vehicle_display_profile_changed
  on public.profiles;
create trigger corrotrans_vehicle_display_profile_changed
after update of full_name, photo_path, photo_updated_at on public.profiles
for each row execute function public.corrotrans_vehicle_display_touch_profile_row();

revoke all on function public.corrotrans_vehicle_display_touch_profile_row()
  from public, anon, authenticated, service_role;

commit;
