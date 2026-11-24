-- ============================================================
-- MIGRATION: Phase 2 and Phase 3 Database Updates
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================

-- 1. EXTEND PROFILES TABLE WITH WALLET, SUBSCRIPTION, APPROVAL AND REFERRAL FIELDS
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('rider', 'owner', 'admin'));

-- Add columns with defaults
alter table public.profiles add column if not exists wallet_balance numeric(10,2) default 0.00 check (wallet_balance >= 0);
alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists is_approved boolean default false;
alter table public.profiles add column if not exists subscription_tier text default 'free' check (subscription_tier in ('free', 'premium', 'enterprise'));
alter table public.profiles add column if not exists subscription_ends_at timestamptz;

-- Generate referral codes for existing profiles
update public.profiles 
set referral_code = upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)) 
where referral_code is null;

-- Make referral_code not null for future entries
alter table public.profiles alter column referral_code set not null;

-- Update handle_new_user trigger function to auto-assign a referral code
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone, role, referral_code, wallet_balance, is_approved, subscription_tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New User'),
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'rider'),
    upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    0.00,
    case when (new.raw_user_meta_data->>'role' = 'owner') then false else true end, -- Owners need approval, riders auto-approved
    'free'
  );
  return new;
end;
$$ language plpgsql security definer;


-- 2. EXTEND PARKING AREAS TABLE WITH APPROVAL, COVERED, AND IMAGES
-- ---------------------------------------------------------------------------
alter table public.parking_areas add column if not exists is_approved boolean default false;
alter table public.parking_areas add column if not exists is_covered boolean default false;
alter table public.parking_areas add column if not exists image_front_gate text;
alter table public.parking_areas add column if not exists image_entry text;
alter table public.parking_areas add column if not exists image_exit text;
alter table public.parking_areas add column if not exists image_slots text;


-- 3. EXTEND BOOKINGS TABLE WITH VEHICLE TYPE, EV ADDON, AND COUPONS
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists slot_type text default 'car' check (slot_type in ('bike', 'car', 'suv', 'ev', 'truck'));
alter table public.bookings add column if not exists has_ev_charging boolean default false;
alter table public.bookings add column if not exists applied_coupon text;
alter table public.bookings add column if not exists discount_amount numeric(10,2) default 0.00;


-- 4. CREATE FAVORITES TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, parking_area_id)
);

alter table public.favorites enable row level security;

create policy "Users can view their own favorites"
  on public.favorites for select
  using (auth.uid() = user_id);

create policy "Users can add their own favorites"
  on public.favorites for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own favorites"
  on public.favorites for delete
  using (auth.uid() = user_id);


-- 5. CREATE PARKING SLOTS TABLE FOR MULTIPLE VEHICLE TYPE CAPACITIES
-- ---------------------------------------------------------------------------
create table if not exists public.parking_slots (
  id uuid primary key default gen_random_uuid(),
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  slot_type text not null check (slot_type in ('bike', 'car', 'suv', 'ev', 'truck')),
  total_slots int not null check (total_slots >= 0),
  available_slots int not null check (available_slots >= 0),
  price_per_hour numeric(10,2) not null check (price_per_hour >= 0),
  created_at timestamptz default now(),
  unique(parking_area_id, slot_type)
);

alter table public.parking_slots enable row level security;

create policy "Anyone can view parking slots"
  on public.parking_slots for select
  using (true);

create policy "Owners can modify slots of their own parking areas"
  on public.parking_slots for all
  using (
    exists (
      select 1 from public.parking_areas pa
      where pa.id = parking_area_id and pa.owner_id = auth.uid()
    )
  );

-- Helper logic: populate parking_slots table for existing parking areas with 'car' slot
insert into public.parking_slots (parking_area_id, slot_type, total_slots, available_slots, price_per_hour)
select id, 'car', total_slots, available_slots, price_per_hour
from public.parking_areas
on conflict do nothing;


-- 6. CREATE COUPONS TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  code text primary key,
  discount_type text not null check (discount_type in ('percentage', 'flat')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  min_booking_amount numeric(10,2) default 0.00 check (min_booking_amount >= 0),
  is_active boolean default true,
  expiry_date timestamptz,
  created_at timestamptz default now()
);

alter table public.coupons enable row level security;

create policy "Anyone can view active coupons"
  on public.coupons for select
  using (is_active = true and (expiry_date is null or expiry_date > now()));

create policy "Only admins can edit coupons"
  on public.coupons for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Seed initial coupon codes
insert into public.coupons (code, discount_type, discount_value, min_booking_amount) values
('FIRST50', 'flat', 50.00, 100.00),
('SAVE20', 'percentage', 20.00, 50.00),
('WELCOME100', 'flat', 100.00, 200.00)
on conflict (code) do nothing;


-- 7. CREATE REFERRALS TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references public.profiles(id) on delete cascade not null,
  referee_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'completed' check (status in ('pending', 'completed')),
  reward_amount numeric(10,2) default 50.00,
  created_at timestamptz default now(),
  unique(referee_id) -- A user can only be referred once
);

alter table public.referrals enable row level security;

create policy "Users can view their referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referee_id);


-- 8. CREATE MONTHLY PASSES TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.monthly_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  start_date timestamptz not null default now(),
  end_date timestamptz not null,
  price_paid numeric(10,2) not null default 2000.00,
  status text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz default now()
);

alter table public.monthly_passes enable row level security;

create policy "Users can view their own monthly passes"
  on public.monthly_passes for select
  using (auth.uid() = user_id);

create policy "Owners can view monthly passes for their areas"
  on public.monthly_passes for select
  using (
    exists (
      select 1 from public.parking_areas pa
      where pa.id = parking_area_id and pa.owner_id = auth.uid()
    )
  );

create policy "Users can purchase monthly passes"
  on public.monthly_passes for insert
  with check (auth.uid() = user_id);


-- 9. CREATE NOTIFICATIONS TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  message text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table public.notifications enable row level security;

create policy "Users can view their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can update their own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

create policy "Users can delete their own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);


-- 10. CREATE INCIDENTS TABLE (FOR SOS ALERTS)
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  type text not null check (type in ('vehicle_damaged', 'emergency', 'need_assistance')),
  details text,
  status text not null default 'active' check (status in ('active', 'resolved')),
  created_at timestamptz default now()
);

alter table public.incidents enable row level security;

create policy "Riders can view and report their own incidents"
  on public.incidents for all
  using (auth.uid() = user_id);

create policy "Owners can view incidents on their parking areas"
  on public.incidents for select
  using (
    exists (
      select 1 from public.parking_areas pa
      where pa.id = parking_area_id and pa.owner_id = auth.uid()
    )
  );

create policy "Admins can view and edit all incidents"
  on public.incidents for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );


-- 11. UPDATE PARKING_BY_CITY WITH FILTERS & AI RECOMMENDATIONS
-- ---------------------------------------------------------------------------
drop function if exists public.parking_by_city(text, double precision, double precision);

create or replace function public.parking_by_city(
  target_city text,
  user_lat double precision default null,
  user_lng double precision default null,
  v_type text default null,
  need_ev boolean default false,
  need_covered boolean default false,
  min_rating numeric default 0,
  max_price numeric default null,
  sort_by text default 'nearest'
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
  distance_km double precision,
  avg_rating numeric,
  review_count bigint,
  is_covered boolean,
  has_ev_slot boolean,
  ai_score numeric
) as $$
begin
  return query
  select
    pa.id, pa.name, pa.address, pa.city, pa.latitude, pa.longitude,
    pa.total_slots, pa.available_slots, pa.price_per_hour,
    -- Distance computation
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
    end as distance_km,
    round(coalesce(avg(r.rating), 0), 1) as avg_rating,
    count(r.id) as review_count,
    pa.is_covered,
    -- check if there is an EV slot type
    exists (
      select 1 from public.parking_slots ps 
      where ps.parking_area_id = pa.id and ps.slot_type = 'ev' and ps.available_slots > 0
    ) as has_ev_slot,
    -- AI Recommendation score calculation: weighted pricing, distance, and rating
    -- Lower price + lower distance + higher rating = higher AI score
    round(
      coalesce(
        (100 - (pa.price_per_hour * 1.5)) * 0.3 + -- Price weight 30%
        (case 
          when user_lat is not null and user_lng is not null then
            greatest(0, 100 - ((6371 * acos(least(1.0, greatest(-1.0, cos(radians(user_lat)) * cos(radians(pa.latitude)) * cos(radians(pa.longitude) - radians(user_lng)) + sin(radians(user_lat)) * sin(radians(pa.latitude)))))) * 10))
          else 50
         end) * 0.4 + -- Distance weight 40%
        (coalesce(avg(r.rating), 3.5) * 20) * 0.3 -- Rating weight 30%
      , 0)::numeric,
      1
    ) as ai_score
  from public.parking_areas pa
  left join public.reviews r on r.parking_area_id = pa.id
  left join public.profiles p on p.id = pa.owner_id
  where pa.is_active = true
    and pa.is_approved = true -- Only approved parkings are public
    and p.is_approved = true  -- Only approved owners are public
    and lower(pa.city) = lower(target_city)
    -- Covered filter
    and (not need_covered or pa.is_covered = true)
    -- Vehicle Slot Type filter (checks slot type details)
    and (v_type is null or exists (
      select 1 from public.parking_slots ps 
      where ps.parking_area_id = pa.id and ps.slot_type = v_type and ps.available_slots > 0
    ))
    -- EV filter
    and (not need_ev or exists (
      select 1 from public.parking_slots ps 
      where ps.parking_area_id = pa.id and ps.slot_type = 'ev' and ps.available_slots > 0
    ))
  group by pa.id
  -- Min Rating filter (applied post-grouping)
  having (min_rating = 0 or coalesce(avg(r.rating), 0) >= min_rating)
    -- Max Price filter (applied post-grouping)
    and (max_price is null or pa.price_per_hour <= max_price)
  order by
    case when sort_by = 'nearest' and user_lat is not null then 1 else 0 end desc,
    case when sort_by = 'nearest' and user_lat is not null then
      (6371 * acos(least(1.0, greatest(-1.0, cos(radians(user_lat)) * cos(radians(pa.latitude)) * cos(radians(pa.longitude) - radians(user_lng)) + sin(radians(user_lat)) * sin(radians(pa.latitude))))))
      else null
    end asc nulls last,
    case when sort_by = 'price_low' then pa.price_per_hour else null end asc,
    case when sort_by = 'rating_high' then coalesce(avg(r.rating), 0) else null end desc,
    case when sort_by = 'ai_recommended' then 
      (coalesce((100 - (pa.price_per_hour * 1.5)) * 0.3, 0) + 
       coalesce((case when user_lat is not null then greatest(0, 100 - ((6371 * acos(least(1.0, greatest(-1.0, cos(radians(user_lat)) * cos(radians(pa.latitude)) * cos(radians(pa.longitude) - radians(user_lng)) + sin(radians(user_lat)) * sin(radians(pa.latitude)))))) * 10)) else 50 end) * 0.4, 0) + 
       coalesce((avg(r.rating) * 20) * 0.3, 21))
      else null
    end desc nulls last,
    pa.name asc;
end;
$$ language plpgsql stable;
