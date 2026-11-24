-- ============================================================
-- MIGRATION: Phase 1 features (QR check-in/exit, wallet payouts, reviews)
-- Only run this if you already have parksmart set up. If you're setting up
-- fresh, ignore this file - schema.sql already includes all of it.
-- ============================================================

-- 1. New columns on bookings for QR check-in/exit and GPS arrival
alter table public.bookings add column if not exists qr_token text unique default gen_random_uuid()::text;
alter table public.bookings add column if not exists entry_time timestamptz;
alter table public.bookings add column if not exists exit_time timestamptz;
alter table public.bookings add column if not exists overtime_amount numeric(10,2) default 0;
alter table public.bookings add column if not exists final_amount numeric(10,2);
alter table public.bookings add column if not exists gps_arrived_at timestamptz;

-- 2. Wallet tables
create table if not exists public.owner_wallets (
  owner_id uuid references public.profiles(id) on delete cascade primary key,
  balance numeric(10,2) not null default 0 check (balance >= 0),
  updated_at timestamptz default now()
);
alter table public.owner_wallets enable row level security;
drop policy if exists "Owners can view their own wallet" on public.owner_wallets;
create policy "Owners can view their own wallet"
  on public.owner_wallets for select using (auth.uid() = owner_id);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  booking_id uuid references public.bookings(id) on delete set null,
  type text not null check (type in ('credit', 'debit')),
  amount numeric(10,2) not null,
  description text,
  created_at timestamptz default now()
);
alter table public.wallet_transactions enable row level security;
drop policy if exists "Owners can view their own transactions" on public.wallet_transactions;
create policy "Owners can view their own transactions"
  on public.wallet_transactions for select using (auth.uid() = owner_id);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'failed')),
  requested_at timestamptz default now(),
  processed_at timestamptz
);
alter table public.payouts enable row level security;
drop policy if exists "Owners can view their own payout requests" on public.payouts;
create policy "Owners can view their own payout requests"
  on public.payouts for select using (auth.uid() = owner_id);
drop policy if exists "Owners can request their own payouts" on public.payouts;
create policy "Owners can request their own payouts"
  on public.payouts for insert with check (auth.uid() = owner_id);

-- 3. Reviews table
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade unique not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  parking_area_id uuid references public.parking_areas(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);
alter table public.reviews enable row level security;
drop policy if exists "Anyone can read reviews" on public.reviews;
create policy "Anyone can read reviews" on public.reviews for select using (true);
drop policy if exists "Users can leave a review on their own completed booking" on public.reviews;
create policy "Users can leave a review on their own completed booking"
  on public.reviews for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.user_id = auth.uid() and b.status = 'completed'
    )
  );

-- 4. Update parking_by_city to include ratings (drop first - return columns changed)
drop function if exists public.parking_by_city(text, double precision, double precision);
create or replace function public.parking_by_city(
  target_city text,
  user_lat double precision default null,
  user_lng double precision default null
)
returns table (
  id uuid, name text, address text, city text,
  latitude double precision, longitude double precision,
  total_slots int, available_slots int, price_per_hour numeric,
  distance_km double precision, avg_rating numeric, review_count bigint
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
  where pa.is_active = true and lower(pa.city) = lower(target_city)
  group by pa.id
  order by
    case when user_lat is not null then 1 else 0 end desc,
    distance_km asc nulls last,
    pa.name asc;
end;
$$ language plpgsql stable;

-- 5. Wallet credit / payout / today's-bookings functions
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

create or replace function public.owner_today_bookings(owner uuid)
returns table (
  booking_id uuid, parking_area_name text, rider_name text,
  status text, amount numeric, entry_time timestamptz, exit_time timestamptz
) as $$
  select b.id, pa.name, p.full_name, b.status, b.amount, b.entry_time, b.exit_time
  from public.bookings b
  join public.parking_areas pa on pa.id = b.parking_area_id
  join public.profiles p on p.id = b.user_id
  where pa.owner_id = owner and b.created_at >= date_trunc('day', now())
  order by b.created_at desc;
$$ language sql stable;

-- 6. IMPORTANT: this migration assumes you're moving OFF the Razorpay Route
-- instant-split model from the previous update, onto the wallet model.
-- If you'd already onboarded owners with Route linked accounts, those
-- columns (razorpay_account_id, payout_onboarded on profiles) are left
-- alone and unused by the new flow - safe to ignore or drop later.
