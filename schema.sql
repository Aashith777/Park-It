-- ============================================================
-- ParkSmart Database Schema for Supabase
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================

-- 1. PROFILES TABLE (extends Supabase's built-in auth.users)
-- -----------------------------------------------------------
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text not null,
  phone text,
  role text not null default 'rider' check (role in ('rider', 'owner')),
  razorpay_account_id text,              -- Razorpay Route linked account ID (owners only)
  payout_onboarded boolean default false, -- true once the linked account is active and can receive payouts
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view all profiles"
  on public.profiles for select
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New User'),
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'rider')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 2. PARKING AREAS TABLE
-- -----------------------------------------------------------
create table public.parking_areas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  address text not null,
  city text not null,                       -- e.g. "Chennai", "Mumbai" - used to filter listings by city
  latitude double precision not null,
  longitude double precision not null,
  total_slots int not null check (total_slots > 0),
  available_slots int not null,
  price_per_hour numeric(10,2) not null check (price_per_hour >= 0),
  is_active boolean default true,
  created_at timestamptz default now()
);

create index idx_parking_areas_city on public.parking_areas (lower(city));

alter table public.parking_areas enable row level security;

create policy "Anyone can view active parking areas"
  on public.parking_areas for select
  using (true);

create policy "Owners can insert their own parking areas"
  on public.parking_areas for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update their own parking areas"
  on public.parking_areas for update
  using (auth.uid() = owner_id);

create policy "Owners can delete their own parking areas"
  on public.parking_areas for delete
  using (auth.uid() = owner_id);


-- 3. BOOKINGS TABLE
-- -----------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  slot_start timestamptz not null,          -- when the booked slot begins
  slot_end timestamptz not null,            -- when the booked slot ends
  arrival_deadline timestamptz not null,    -- slot_start + grace period; auto-cancel after this if not checked in
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'booked', 'checked_in', 'completed', 'cancelled', 'expired')),
  amount numeric(10,2) not null,               -- total amount the rider pays (gross)
  platform_fee_amount numeric(10,2),            -- platform's 15% cut, set at payment time
  owner_payout_amount numeric(10,2),            -- owner's 85% share, set at payment time
  razorpay_transfer_id text,                    -- Route transfer ID once the split payout is created
  transfer_status text default 'pending'
    check (transfer_status in ('pending', 'processed', 'failed', 'not_applicable')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'refunded', 'failed')),
  razorpay_order_id text,
  razorpay_payment_id text,
  checked_in_at timestamptz,
  qr_token text unique default gen_random_uuid()::text, -- printed as a QR code; owner scans this to verify entry/exit
  entry_time timestamptz,     -- set when owner scans QR at entry
  exit_time timestamptz,      -- set when owner scans QR at exit
  overtime_amount numeric(10,2) default 0,   -- extra owed if the rider stayed past slot_end (settled in person, not auto-charged)
  final_amount numeric(10,2), -- amount + overtime_amount, set once the booking completes
  gps_arrived_at timestamptz, -- set client-side when the rider's live GPS gets within range of the lot (informational only - NOT proof of entry, that's what the QR scan is for)
  created_at timestamptz default now()
);

alter table public.bookings enable row level security;

create policy "Users can view their own bookings"
  on public.bookings for select
  using (auth.uid() = user_id);

create policy "Owners can view bookings on their parking areas"
  on public.bookings for select
  using (
    exists (
      select 1 from public.parking_areas pa
      where pa.id = parking_area_id and pa.owner_id = auth.uid()
    )
  );

create policy "Users can insert their own bookings"
  on public.bookings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own bookings (e.g. check-in, cancel)"
  on public.bookings for update
  using (auth.uid() = user_id);


-- 3b. OWNER WALLET (holds each owner's accumulated, withdrawable earnings)
-- -----------------------------------------------------------
create table public.owner_wallets (
  owner_id uuid references public.profiles(id) on delete cascade primary key,
  balance numeric(10,2) not null default 0 check (balance >= 0),
  updated_at timestamptz default now()
);

alter table public.owner_wallets enable row level security;

create policy "Owners can view their own wallet"
  on public.owner_wallets for select
  using (auth.uid() = owner_id);


-- 3c. WALLET TRANSACTIONS (ledger - every credit/debit against a wallet)
-- -----------------------------------------------------------
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  booking_id uuid references public.bookings(id) on delete set null,
  type text not null check (type in ('credit', 'debit')),
  amount numeric(10,2) not null,
  description text,
  created_at timestamptz default now()
);

alter table public.wallet_transactions enable row level security;

create policy "Owners can view their own transactions"
  on public.wallet_transactions for select
  using (auth.uid() = owner_id);


-- 3d. PAYOUTS (withdrawal requests - owner clicks "Withdraw", platform settles to their bank manually or via RazorpayX later)
-- -----------------------------------------------------------
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'failed')),
  requested_at timestamptz default now(),
  processed_at timestamptz
);

alter table public.payouts enable row level security;

create policy "Owners can view their own payout requests"
  on public.payouts for select
  using (auth.uid() = owner_id);

create policy "Owners can request their own payouts"
  on public.payouts for insert
  with check (auth.uid() = owner_id);


-- 3e. REVIEWS (one per completed booking)
-- -----------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade unique not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

alter table public.reviews enable row level security;

create policy "Anyone can read reviews"
  on public.reviews for select
  using (true);

create policy "Users can leave a review on their own completed booking"
  on public.reviews for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.user_id = auth.uid() and b.status = 'completed'
    )
  );


-- 4. NEARBY PARKING SEARCH FUNCTION (Haversine distance, in km)
-- -----------------------------------------------------------
create or replace function public.nearby_parking(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision default 5
)
returns table (
  id uuid,
  name text,
  address text,
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
    pa.id, pa.name, pa.address, pa.latitude, pa.longitude,
    pa.total_slots, pa.available_slots, pa.price_per_hour,
    (
      6371 * acos(
        cos(radians(user_lat)) * cos(radians(pa.latitude)) *
        cos(radians(pa.longitude) - radians(user_lng)) +
        sin(radians(user_lat)) * sin(radians(pa.latitude))
      )
    ) as distance_km
  from public.parking_areas pa
  where pa.is_active = true and pa.available_slots > 0
  having (
    6371 * acos(
      cos(radians(user_lat)) * cos(radians(pa.latitude)) *
      cos(radians(pa.longitude) - radians(user_lng)) +
      sin(radians(user_lat)) * sin(radians(pa.latitude))
    )
  ) <= radius_km
  order by distance_km asc;
end;
$$ language plpgsql stable;


-- 4b. CITY-BASED PARKING SEARCH
-- -----------------------------------------------------------
-- Returns every active parking area in a given city, regardless of distance
-- (a city can be large - this is not radius-limited like nearby_parking above).
-- If user_lat/user_lng are passed, also computes distance for sorting/display;
-- otherwise distance_km comes back null and results are just alphabetical.
-- Also includes average rating + review count from the reviews table.
drop function if exists public.parking_by_city(text, double precision, double precision);

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
  distance_km double precision,
  avg_rating numeric,
  review_count bigint
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
    end as distance_km,
    round(avg(r.rating), 1) as avg_rating,
    count(r.id) as review_count
  from public.parking_areas pa
  left join public.reviews r on r.parking_area_id = pa.id
  where pa.is_active = true
    and lower(pa.city) = lower(target_city)
  group by pa.id
  order by
    case when user_lat is not null then 1 else 0 end desc, -- distance sort only if coords given
    distance_km asc nulls last,
    pa.name asc;
end;
$$ language plpgsql stable;


-- 4c. LIST ALL CITIES THAT HAVE PARKING LISTED (for the city picker dropdown)
-- -----------------------------------------------------------
create or replace function public.list_cities()
returns table (city text) as $$
  select distinct pa.city
  from public.parking_areas pa
  where pa.is_active = true
  order by pa.city asc;
$$ language sql stable;


-- 5. OWNER DASHBOARD STATS FUNCTION (bookings count + revenue split)
-- -----------------------------------------------------------
create or replace function public.owner_dashboard_stats(owner uuid)
returns table (
  parking_area_id uuid,
  parking_area_name text,
  total_bookings bigint,
  active_bookings bigint,
  gross_revenue numeric,      -- total riders paid (before commission)
  platform_fee numeric,       -- platform's 15% cut
  net_payout numeric          -- owner's 85% share (what actually gets paid out)
) as $$
begin
  return query
  select
    pa.id,
    pa.name,
    count(b.id) filter (where b.payment_status = 'paid') as total_bookings,
    count(b.id) filter (where b.status in ('booked','checked_in')) as active_bookings,
    coalesce(sum(b.amount) filter (where b.payment_status = 'paid'), 0) as gross_revenue,
    coalesce(sum(b.platform_fee_amount) filter (where b.payment_status = 'paid'), 0) as platform_fee,
    coalesce(sum(b.owner_payout_amount) filter (where b.payment_status = 'paid'), 0) as net_payout
  from public.parking_areas pa
  left join public.bookings b on b.parking_area_id = pa.id
  where pa.owner_id = owner
  group by pa.id, pa.name;
end;
$$ language plpgsql stable;


-- 6. AUTO-CANCEL FUNCTION (called by a scheduled job / cron every minute)
-- -----------------------------------------------------------
-- Cancels paid bookings where the rider never checked in before the arrival deadline,
-- and returns the slot back to available_slots. This is what "reduces traffic":
-- a no-show frees the spot immediately instead of holding it uselessly.
create or replace function public.auto_cancel_expired_bookings()
returns void as $$
declare
  rec record;
begin
  for rec in
    select * from public.bookings
    where status = 'booked'
      and payment_status = 'paid'
      and arrival_deadline < now()
  loop
    update public.bookings
      set status = 'expired'
      where id = rec.id;

    update public.parking_areas
      set available_slots = available_slots + 1
      where id = rec.parking_area_id;
  end loop;
end;
$$ language plpgsql security definer;

-- Schedule it with pg_cron (enable the extension first in Supabase Dashboard -> Database -> Extensions)
-- Then run:
-- select cron.schedule('auto-cancel-bookings', '* * * * *', 'select public.auto_cancel_expired_bookings();');


-- 7. CREDIT OWNER WALLET (called right after a payment is verified as paid)
-- -----------------------------------------------------------
-- Adds the owner's share (already computed as owner_payout_amount on the
-- booking) to their wallet balance, and logs it as a transaction. This is
-- the "profit sharing" step: the rider's full payment already sat with the
-- platform's Razorpay account - this just updates the internal ledger of
-- how much of that the owner is now entitled to withdraw.
create or replace function public.credit_owner_wallet(p_booking_id uuid)
returns void as $$
declare
  v_owner_id uuid;
  v_amount numeric;
begin
  select pa.owner_id, b.owner_payout_amount
    into v_owner_id, v_amount
  from public.bookings b
  join public.parking_areas pa on pa.id = b.parking_area_id
  where b.id = p_booking_id;

  if v_owner_id is null or v_amount is null then
    return;
  end if;

  insert into public.owner_wallets (owner_id, balance)
    values (v_owner_id, v_amount)
    on conflict (owner_id) do update
      set balance = public.owner_wallets.balance + excluded.balance,
          updated_at = now();

  insert into public.wallet_transactions (owner_id, booking_id, type, amount, description)
    values (v_owner_id, p_booking_id, 'credit', v_amount, 'Booking payout share');
end;
$$ language plpgsql security definer;


-- 8. REQUEST A PAYOUT (owner clicks "Withdraw" - atomically checks balance
--    and reserves the funds so they can't double-withdraw)
-- -----------------------------------------------------------
create or replace function public.request_payout(p_owner uuid, p_amount numeric)
returns uuid as $$
declare
  v_balance numeric;
  v_payout_id uuid;
begin
  select balance into v_balance from public.owner_wallets where owner_id = p_owner for update;

  if v_balance is null or v_balance < p_amount then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.owner_wallets set balance = balance - p_amount, updated_at = now()
    where owner_id = p_owner;

  insert into public.payouts (owner_id, amount, status)
    values (p_owner, p_amount, 'requested')
    returning id into v_payout_id;

  insert into public.wallet_transactions (owner_id, type, amount, description)
    values (p_owner, 'debit', p_amount, 'Withdrawal requested');

  return v_payout_id;
end;
$$ language plpgsql security definer;


-- 9. OWNER'S BOOKINGS FOR TODAY (for the "Today's customers" dashboard table)
-- -----------------------------------------------------------
create or replace function public.owner_today_bookings(owner uuid)
returns table (
  booking_id uuid,
  parking_area_name text,
  rider_name text,
  status text,
  amount numeric,
  entry_time timestamptz,
  exit_time timestamptz
) as $$
  select
    b.id, pa.name, p.full_name, b.status, b.amount, b.entry_time, b.exit_time
  from public.bookings b
  join public.parking_areas pa on pa.id = b.parking_area_id
  join public.profiles p on p.id = b.user_id
  where pa.owner_id = owner
    and b.created_at >= date_trunc('day', now())
  order by b.created_at desc;
$$ language sql stable;
