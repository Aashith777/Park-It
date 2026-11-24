# ParkSmart — Parking Slot Booking Platform

Book a parking slot near your destination ahead of time, pay via UPI, get
navigation to it, and if you don't show up in time the slot is automatically
released for someone else. Owners get a live dashboard of bookings and revenue.

## Architecture

```
┌─────────────────┐      ┌────────────────────┐      ┌──────────────────┐
│   React frontend │◄────►│      Supabase       │      │  Payment server   │
│  (Vite + Tailwind)│     │ (Postgres + Auth +  │◄────►│  (Node/Express +  │
│                  │      │  Realtime + RLS)    │      │   Razorpay)       │
└─────────────────┘      └────────────────────┘      └──────────────────┘
```

- **Supabase** handles: user accounts (Auth), the database (Postgres), row-level
  security (so riders only see their own bookings, owners only see bookings on
  their own lots), geolocation "nearby parking" search, and real-time updates
  for the owner dashboard.
- **Payment server** is a tiny Node app that does the one thing Supabase can't
  do safely from the browser: talk to Razorpay using a *secret* key, and
  verify that a payment actually happened before marking a booking as paid.
  It also runs the auto-cancel job.
- **Frontend** is a normal React app that talks to Supabase directly for
  almost everything, and only calls the payment server for the two payment
  steps.

Why Razorpay: it's an Indian payment gateway that supports UPI directly in its
checkout widget (along with cards/netbanking), and has a free test/sandbox mode.

---

## Part 1 — Set up Supabase (the database)

1. Go to https://supabase.com → **New project**. Pick a name, password, and
   region (pick one close to India, e.g. Mumbai/`ap-south-1`).
2. Once it's created, go to **SQL Editor → New query**, paste in the entire
   contents of `supabase/schema.sql` from this project, and run it. This creates:
   - `profiles` table (extends Supabase's built-in auth with `role: rider/owner`)
   - `parking_areas` table
   - `bookings` table
   - a `nearby_parking()` function (distance search using the Haversine formula)
   - an `owner_dashboard_stats()` function (bookings + revenue per lot)
   - an `auto_cancel_expired_bookings()` function
   - Row Level Security policies so users only ever see their own data
3. **(Recommended) Enable the auto-cancel schedule inside Postgres itself:**
   Go to **Database → Extensions**, enable `pg_cron`, then in SQL Editor run:
   ```sql
   select cron.schedule('auto-cancel-bookings', '* * * * *', 'select public.auto_cancel_expired_bookings();');
   ```
   This runs the auto-cancel check every minute inside the database — you
   don't even need the Node cron job below if you do this. If your Supabase
   plan doesn't support `pg_cron`, skip this and rely on the payment server's
   built-in cron job instead (already wired up for you).
4. Go to **Project Settings → API**. You'll need three values later:
   - `Project URL` → used as `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - `anon public` key → used as `VITE_SUPABASE_ANON_KEY` (frontend only)
   - `service_role` key → used as `SUPABASE_SERVICE_ROLE_KEY` (payment server
     only — **never** put this in frontend code, it bypasses all security rules)

---

## Part 2 — Set up Razorpay (UPI payments)

1. Sign up free at https://dashboard.razorpay.com/signup
2. Switch to **Test Mode** (top-right toggle) while developing — test mode is
   free and lets you simulate UPI payments without real money.
3. Go to **Settings → API Keys → Generate Test Key**. You get:
   - `Key Id` → `RAZORPAY_KEY_ID`
   - `Key Secret` → `RAZORPAY_KEY_SECRET`
4. To actually go live later: complete Razorpay's KYC/business verification
   (needed for any real UPI/payment gateway in India), then switch to live keys.

---

## Part 3 — Run the payment server

```bash
cd payment-server
npm install
cp .env.example .env
# edit .env and fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
npm run dev
```

You should see:
```
🚀 ParkSmart payment server running on port 5000
⏱  Auto-cancel cron job scheduled (every minute)
```

## Part 4 — Run the frontend

```bash
cd frontend
npm install
cp .env.example .env
# edit .env and fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
# (VITE_PAYMENT_SERVER_URL can stay as http://localhost:5000)
npm run dev
```

Open http://localhost:5173 — that's your website.

---

## Part 5 — Try the full flow

1. **Register as an owner**: click "Get started" → toggle "I own a lot" →
   sign up → confirm the email Supabase sends you → log in.
2. **List a parking area**: go to "Add Parking", click "Use my current
   location" (or type coordinates manually), set total slots and price/hour,
   submit.
3. **Register a second account as a rider** (use a different email, e.g. an
   email alias like `you+rider@gmail.com`, or an incognito window).
4. **Search**: go to "Find Parking", allow location access. You'll see the
   parking area you just listed (as long as you're within the radius).
5. **Book & pay**: click "Book slot", pick duration, click "Pay & Book". In
   Razorpay test mode, the checkout widget will show a UPI option — use
   Razorpay's test UPI ID `success@razorpay` to simulate a successful payment
   (see Razorpay's test mode docs for the current test credentials).
6. **Navigate**: click "Navigate" — opens Google Maps directions to the spot.
7. **Auto-cancel**: don't click "I've arrived" — after the grace period
   (default 15 minutes, set in `payment-server/.env` as
   `GRACE_PERIOD_MINUTES` and mirrored in
   `frontend/src/components/BookingModal.jsx`), the cron job flips the
   booking to `expired` and gives the slot back to the pool.
8. **Owner dashboard**: log back in as the owner → "Dashboard" shows bookings
   count and revenue per parking area, updating in real time.

---

## Part 5b — City-based filtering (Chennai riders see Chennai parking, etc.)

Riders are shown parking areas that belong to **their own city**, detected
automatically from their location, with a manual dropdown to switch cities.

**If you're setting this up fresh:** the schema.sql in this project already
includes the `city` column and the `parking_by_city()` / `list_cities()`
functions — nothing extra to do, just follow Part 1 as normal.

**If you already ran the original schema.sql before this update:** run the
migration instead:
1. Supabase Dashboard → SQL Editor → New query
2. Paste in the contents of `supabase/migration_add_city.sql`, run it.
3. Go to Table Editor → `parking_areas` → for any existing rows, fill in the
   `city` column manually (it was set to `"Unknown"` by the migration).

**How it works:**
- When an owner adds a parking area, clicking "Use my current location" also
  auto-fills a `City` field via a free reverse-geocoding lookup
  (BigDataCloud's client-side API — no signup, no API key). The field stays
  editable in case the auto-detected name isn't quite right.
- When a rider opens "Find Parking", the same reverse-geocoding runs on their
  coordinates to detect their city, and the results are filtered to only that
  city via the `parking_by_city()` SQL function.
- A city dropdown next to the results lets the rider switch to a different
  city manually (e.g. searching for parking in a city they're about to travel
  to, not the one they're currently standing in).

---

## Part 5c — Live navigation (map, live distance, ETA)

Once a rider has a booked slot, "My Bookings" now shows an inline live map
with:
- 📍 the rider's current location, updating as they move
- 🅿️ a pin at the parking area
- a line connecting the two
- live-updating **distance** and an **estimated arrival time**
- a **"Start navigation"** button that hands off to Google Maps for actual
  turn-by-turn directions

**Nothing to configure — no API key needed.** This uses:
- **Leaflet + OpenStreetMap** (loaded via CDN in `index.html`) for the map
  itself — free and open, unlike the Google Maps JavaScript SDK which
  requires a billing-enabled API key.
- The browser's built-in geolocation `watchPosition` for live position
  updates.
- A simple `distance ÷ average speed` calculation for ETA
  (`frontend/src/utils/geo.js`), labeled as an estimate. This is intentionally
  not traffic-aware — real-time traffic ETA requires a paid routing API
  (Google Directions, Mapbox Directions, etc.). If you want that upgrade
  later, swap `estimateEtaMinutes()` for a call to one of those APIs; every
  other part of the app stays the same.
- Turn-by-turn navigation itself is **not** reimplemented — it hands off to
  the Google Maps app/website via the same deep link used elsewhere in the
  app, since Google already does this better than a custom build would.

The search results list also shows a quick distance + ETA badge on each
parking card, using the same estimate, so riders can compare options before
they even book.

---

## Part 4b — Revenue split with parking lot owners (15% platform / 85% owner)

Every booking's payment goes to the **platform's own Razorpay account** in
full (nothing splits at payment time — no Route approval needed for this
core flow). Right after payment is verified, the owner's 85% share is
credited to an internal **wallet** on their account. The owner dashboard
shows that balance, and they click **Withdraw** whenever they want to cash
it out.

**Setup:**
1. **If setting up fresh:** `supabase/schema.sql` already includes the wallet
   tables and commission fields — nothing extra to do.
2. **If you already ran an older schema:** run
   `supabase/migration_phase1.sql` in the SQL Editor (this also adds the QR
   check-in/exit fields and reviews table covered below).
3. Add this to `payment-server/.env` if it isn't already there:
   ```
   PLATFORM_COMMISSION_PERCENT=15
   ```

**How withdrawal actually works right now:** clicking "Withdraw" reserves
the funds (moves them out of the visible balance immediately, so an owner
can't request the same money twice) and creates a row in the `payouts`
table with status `requested`. **Nothing here moves money to a bank account
yet** — that's a deliberate scope boundary, because doing that automatically
requires Razorpay's Payouts product (**RazorpayX**), which — like Route —
needs Razorpay to approve your business account first. Until you set that
up, treat `payouts` as a queue: check it in Supabase's Table Editor
periodically, transfer the money yourself (bank transfer/UPI), then mark
the row `processed` in Supabase.

**To automate the payout step later:** add a call to
`razorpay.payouts.create(...)` (via RazorpayX) inside
`payment-server/routes/wallet.js`'s `/withdraw` handler, and update the
payout's status based on the response. Everything else in the app stays
exactly the same.

**What each file does:**
| File | Role |
|---|---|
| `payment-server/routes/payment.js` | Computes the 85/15 split at booking time; credits the owner's wallet via `credit_owner_wallet()` once payment is verified |
| `payment-server/routes/wallet.js` | Balance + transaction history; handles withdrawal requests |
| `payment-server/middleware/requireAuth.js` | Verifies the caller is really who they claim (via their Supabase session token) before touching wallet/check-in data |
| `frontend/src/pages/OwnerDashboard.jsx` | Shows wallet balance, withdraw button, transaction history, revenue breakdown |

**Note on `ownerOnboarding.js` / `OwnerPayoutSetup.jsx`:** these still exist
from an earlier iteration and create a Razorpay Route linked account, which
would let you *also* offer instant-split payouts as an option later (still
gated on Razorpay approving Route for your account). They're not required
for the wallet flow above and aren't wired into the default payout path.

---

## Part 4c — QR check-in/check-out (prevents fake bookings)

Every booking gets a random, unguessable `qr_token` the moment it's
created. Once paid, the rider's "My Bookings" page renders that token as a
QR code (via the `qrcode` library). The owner scans it with their own
phone camera (via `html5-qrcode`, no app install needed — it's a browser
camera scan) at **Owner → Scan QR**.

- **First scan (Entry mode):** marks the booking `checked_in`, records
  `entry_time`. Fails if the booking isn't paid, is already checked in, or
  belongs to a different owner's lot — the server checks this against the
  scanning owner's real session, not anything the client claims.
- **Second scan (Exit mode):** marks the booking `completed`, records
  `exit_time`, and calculates **overtime** if the rider stayed past their
  booked `slot_end` (extra hours × the lot's hourly rate). Overtime is
  **not auto-charged** — there's no saved payment method in this flow — it's
  shown to the owner to collect in person, and logged on the booking either
  way.

This is also why the rider's own "I've arrived" button was removed — the
owner's QR scan is the only thing that actually marks arrival now, which is
the point (a rider claiming they arrived, unchecked, is exactly the "fake
booking" problem QR check-in exists to prevent). The live GPS map still
runs underneath and shows a soft "you're near the lot" banner as a nudge,
but that's informational only.

---

## Part 4d — Reviews

After a booking reaches `completed`, "My Bookings" shows a **"Leave a
review"** prompt (1–5 stars + optional comment). Once submitted, that
booking shows "✓ You reviewed this booking" and can't be reviewed again
(enforced both by a unique constraint on `booking_id` in the `reviews`
table and a row-level security policy that only allows the review if the
booking is genuinely `completed` and belongs to that rider).

Average rating and review count now show up automatically on every search
result and parking card (`parking_by_city()` was updated to compute
`avg_rating`/`review_count` via a join, no extra queries needed on the
frontend).

---

## Part 6 — Deploy it for real

| Piece | Where to deploy | Notes |
|---|---|---|
| Frontend | Vercel or Netlify | `npm run build` produces `frontend/dist`; set the same env vars in the host's dashboard |
| Payment server | Render, Railway, or Fly.io | Set env vars there; make sure `CLIENT_URL` matches your deployed frontend URL for CORS |
| Database | Supabase (already hosted) | No extra step — it's already live at your project URL |

Once deployed, switch Razorpay to **Live Mode** and use live keys only after
completing their business verification — UPI payments to a real bank account
require that.

---

## How each requirement maps to the code

| Your requirement | Where it's implemented |
|---|---|
| Book parking near current location | `frontend/src/pages/Search.jsx` (browser geolocation) + `nearby_parking()` / `parking_by_city()` SQL functions |
| Reduce traffic via auto-cancel if late | `arrival_deadline` column + `auto_cancel_expired_bookings()` + `payment-server/jobs/autoCancel.js` or `pg_cron` |
| UPI / online payment | `payment-server/routes/payment.js` + Razorpay Checkout in `BookingModal.jsx` |
| Owner sees bookings + revenue | `owner_dashboard_stats()` SQL function + `frontend/src/pages/OwnerDashboard.jsx` |
| Navigation to parking area | `LiveMap.jsx` (live position, distance, ETA) + Google Maps deep link for turn-by-turn |
| Owner adds parking area | `frontend/src/pages/AddParking.jsx` |
| City-based filtering | `city` column + `parking_by_city()` / `list_cities()` SQL functions |
| Profit sharing (15/85 wallet) | `credit_owner_wallet()` / `request_payout()` SQL functions + `payment-server/routes/wallet.js` |
| QR check-in/exit | `qr_token` column + `payment-server/routes/checkin.js` + `QRCodeCard.jsx` / `OwnerScanner.jsx` |
| Reviews | `reviews` table + `ReviewModal.jsx` + rating fields on `parking_by_city()` |
| Supabase as the database | Everything in `supabase/schema.sql`, used directly by the frontend via `@supabase/supabase-js` |

---

## Roadmap for Phase 2 & 3 (not yet built — here's how each would fit in)

These weren't built in this pass since fully coding all of them would mean
shallow, likely-broken versions of everything instead of solid versions of
what matters most. Ask for any one of these next and I'll build it fully,
the same way Phase 1 was built. Here's the shape each one would take:

### Phase 2

| Feature | What it needs |
|---|---|
| Favorite parking | `favorites` table (user_id, parking_area_id) + heart icon toggle on `ParkingCard.jsx` |
| Search filters (price, covered, vehicle type, EV) | New columns on `parking_areas` (`vehicle_type`, `is_covered`, `has_ev_charging`) + filter UI in `Search.jsx` + extend `parking_by_city()`'s `where` clause |
| Nearest-first sort | Already computed (`distance_km`) — just a sort toggle in the UI, no backend change |
| Notifications | Needs a push channel: either browser Push API (free, but requires a service worker) or a 3rd-party service (OneSignal, Firebase Cloud Messaging) for real mobile push |
| Email receipts | Supabase Edge Function triggered on booking completion, using an email API (Resend, Postmark, or SendGrid - all need their own account/API key) |
| Owner approval before going public | Add `approval_status` to `parking_areas` (default `pending`), an admin-only view to approve, and filter `is_active` on approval |
| Parking images | Supabase Storage bucket + image upload in `AddParking.jsx` |
| Multiple slot types + peak-hour pricing | Restructure `parking_areas` into a `slot_types` child table (vehicle type, price) and a `pricing_rules` table (time range → multiplier) |
| Coupons | `coupons` table (code, discount type/amount, usage limits) + apply logic in `BookingModal.jsx` before creating the Razorpay order |
| Referral system | `referrals` table + wallet credit (reuses the wallet system already built) on both sides when a referred signup completes their first booking |
| Monthly pass | A `passes` table + a booking type that skips per-slot payment and checks pass validity instead |
| Owner subscription tiers | `subscription_tier` on `profiles` + Razorpay Subscriptions (a different Razorpay product, needs its own setup) instead of/alongside commission |

### Phase 3

| Feature | What it needs |
|---|---|
| AI parking recommendation | A ranking function combining distance, price, rating, and availability - can start as a weighted SQL `order by`, no ML needed for v1 |
| Occupancy prediction | Requires historical occupancy data over time (needs weeks/months of real usage first) + a basic time-series model |
| Heat map | Aggregate `available_slots / total_slots` per area, render as colored map markers in `LiveMap.jsx`/Leaflet - no new infrastructure needed |
| Admin dashboard | A `role = 'admin'` addition to `profiles` + a new set of aggregate SQL functions across all owners/cities (not just one owner, like `owner_dashboard_stats()` is scoped to today) |
| Fraud detection | Starts with simple rule-based checks (same device booking repeatedly, impossible travel speed between bookings) before any ML |
| Analytics charts | Frontend charting library (recharts) + SQL aggregate queries grouped by day/week/city - mostly UI work once the data model above exists |
| EV charging booking | Extends the "multiple slot types" work from Phase 2 with a charging-specific slot type and a charger-status field |
| Emergency contact / SOS | Needs the rider's phone number surfaced to the owner (already stored in `profiles`) + a `tel:` link, or a proper SOS log for real emergency handling |

---

## Turning this into a mobile app later

This is a website (PWA-ready structure). To turn it into an installable app
without rewriting everything, the two realistic paths are:
1. Wrap it with **Capacitor** (from the Ionic team) — package this same React
   app as an Android/iOS app, reusing 100% of this code.
2. Rebuild the UI in **React Native**, reusing the Supabase client, database
   schema, and payment server as-is (only the frontend changes).

Both are separate follow-up projects once the website is working end-to-end.
