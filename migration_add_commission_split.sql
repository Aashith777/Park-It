-- ============================================================
-- MIGRATION: Add commission split (15% platform / 85% owner) + Razorpay
-- Route payout fields to an EXISTING ParkSmart project.
-- Only run this if you already ran schema.sql before this update.
-- If you're setting up ParkSmart fresh, ignore this file - the
-- updated schema.sql already includes all of this.
-- ============================================================

-- 1. Owner payout account fields on profiles
alter table public.profiles add column if not exists razorpay_account_id text;
alter table public.profiles add column if not exists payout_onboarded boolean default false;

-- 2. Commission split fields on bookings
alter table public.bookings add column if not exists platform_fee_amount numeric(10,2);
alter table public.bookings add column if not exists owner_payout_amount numeric(10,2);
alter table public.bookings add column if not exists razorpay_transfer_id text;
alter table public.bookings add column if not exists transfer_status text default 'pending';

-- Add the check constraint separately (skipped if it already exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_transfer_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_transfer_status_check
      check (transfer_status in ('pending', 'processed', 'failed', 'not_applicable'));
  end if;
end $$;

-- 3. Updated owner dashboard stats function (gross / fee / net breakdown)
create or replace function public.owner_dashboard_stats(owner uuid)
returns table (
  parking_area_id uuid,
  parking_area_name text,
  total_bookings bigint,
  active_bookings bigint,
  gross_revenue numeric,
  platform_fee numeric,
  net_payout numeric
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
