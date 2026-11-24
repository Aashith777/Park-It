-- ============================================================
-- MIGRATION: Add city-based filtering to an EXISTING ParkSmart project
-- Only run this if you already ran the original schema.sql before.
-- If you're setting up ParkSmart fresh, ignore this file -
-- the updated schema.sql already includes all of this.
-- ============================================================

-- 1. Add the city column (allow null briefly so existing rows don't break)
alter table public.parking_areas add column if not exists city text;

-- 2. If you already have parking areas listed, set a default city for them
--    so the "not null" constraint below doesn't fail. Edit this to match
--    your existing data, or just set them all to one city and fix later
--    in the Table Editor.
update public.parking_areas set city = 'Unknown' where city is null;

-- 3. Now make it required going forward
alter table public.parking_areas alter column city set not null;

-- 4. Index for fast city lookups
create index if not exists idx_parking_areas_city on public.parking_areas (lower(city));

-- 5. Add the two new functions (safe to re-run, uses "or replace")
create or replace function public.parking_by_city(
  target_city text,
  user_lat double precision default null,
  user_lng double precision default null
)
returns table (
  id uuid,
  name text,
  address text,
  city text,
  latitude double precision,
  longitude double precision,
  total_slots int,
  available_slots int,
  price_per_hour numeric,
  distance_km double precision
) as $$
begin
  return query
  select
    pa.id, pa.name, pa.address, pa.city, pa.latitude, pa.longitude,
    pa.total_slots, pa.available_slots, pa.price_per_hour,
    case
      when user_lat is not null and user_lng is not null then
        6371 * acos(
          least(1.0, greatest(-1.0,
            cos(radians(user_lat)) * cos(radians(pa.latitude)) *
            cos(radians(pa.longitude) - radians(user_lng)) +
            sin(radians(user_lat)) * sin(radians(pa.latitude))
          ))
        )
      else null
    end as distance_km
  from public.parking_areas pa
  where pa.is_active = true
    and lower(pa.city) = lower(target_city)
  order by
    case when user_lat is not null then 1 else 0 end desc,
    distance_km asc nulls last,
    pa.name asc;
end;
$$ language plpgsql stable;

create or replace function public.list_cities()
returns table (city text) as $$
  select distinct pa.city
  from public.parking_areas pa
  where pa.is_active = true
  order by pa.city asc;
$$ language sql stable;
