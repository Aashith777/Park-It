import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";
import LiveMap from "../components/LiveMap";
import QRCodeCard from "../components/QRCodeCard";
import ReviewModal from "../components/ReviewModal";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

function Countdown({ deadline }) {
  const [remaining, setRemaining] = useState(new Date(deadline) - new Date());

  useEffect(() => {
    const t = setInterval(() => setRemaining(new Date(deadline) - new Date()), 1000);
    return () => clearInterval(t);
  }, [deadline]);

  if (remaining <= 0) return <span className="text-red-600 font-medium">Expired</span>;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <span className="font-semibold text-signal">
      {mins}:{secs.toString().padStart(2, "0")} left to arrive
    </span>
  );
}

const statusStyles = {
  pending_payment: "bg-yellow-100 text-yellow-700",
  booked: "bg-emerald-100 text-emerald-800",
  checked_in: "bg-blue-100 text-blue-700",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-600",
  expired: "bg-red-100 text-red-600",
};

const TABS = {
  upcoming: ["pending_payment", "booked", "checked_in"],
  completed: ["completed"],
  cancelled: ["cancelled", "expired"],
  referrals: []
};

export default function MyBookings() {
  const { session, profile } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [reviewedBookingIds, setReviewedBookingIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("upcoming");
  const [reviewTarget, setReviewTarget] = useState(null);
  const [arrivedBanner, setArrivedBanner] = useState(new Set());
  
  // SOS emergency states
  const [sosBooking, setSosBooking] = useState(null);
  const [sosType, setSosType] = useState("need_assistance");
  const [sosDetails, setSosDetails] = useState("");
  const [sosLoading, setSosLoading] = useState(false);
  const [sosMsg, setSosMsg] = useState("");

  // Referral states
  const [referralStats, setReferralStats] = useState(null);
  const [inputCode, setInputCode] = useState("");
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState("");
  const [refSuccess, setRefSuccess] = useState("");

  // Invoice visual modal states
  const [activeInvoice, setActiveInvoice] = useState(null);

  const fetchBookings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bookings")
      .select("*, parking_areas(id, name, address, latitude, longitude)")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setBookings(data || []);

    const { data: reviews } = await supabase
      .from("reviews")
      .select("booking_id")
      .eq("user_id", session.user.id);
    setReviewedBookingIds(new Set((reviews || []).map((r) => r.booking_id)));

    setLoading(false);
  };

  const fetchReferralStats = async () => {
    if (tab !== "referrals") return;
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/referrals/stats`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setReferralStats(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "referrals") {
      fetchReferralStats();
    }
  }, [tab]);

  const cancelBooking = async (booking) => {
    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
    const { data: area } = await supabase
      .from("parking_areas")
      .select("available_slots")
      .eq("id", booking.parking_area_id)
      .single();
    if (area) {
      await supabase
        .from("parking_areas")
        .update({ available_slots: area.available_slots + 1 })
        .eq("id", booking.parking_area_id);
    }
    fetchBookings();
  };

  const handleNearby = async (booking) => {
    setArrivedBanner((prev) => new Set(prev).add(booking.id));
    await supabase
      .from("bookings")
      .update({ gps_arrived_at: new Date().toISOString() })
      .eq("id", booking.id);
  };

  const handleTriggerSos = async () => {
    if (!sosBooking) return;
    setSosLoading(true);
    setSosMsg("");
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/sos/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          bookingId: sosBooking.id,
          type: sosType,
          details: sosDetails
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSosMsg("🚨 SOS alert broadcasted! Staff and admin have been notified.");
        setSosDetails("");
        setTimeout(() => {
          setSosBooking(null);
          setSosMsg("");
        }, 3000);
      } else {
        setError(data.error || "Failed to trigger SOS");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSosLoading(false);
    }
  };

  const handleApplyReferral = async (e) => {
    e.preventDefault();
    setRefError("");
    setRefSuccess("");
    setRefLoading(true);
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/referrals/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ code: inputCode })
      });
      const data = await res.json();
      if (res.ok) {
        setRefSuccess(data.message);
        setInputCode("");
        fetchReferralStats();
      } else {
        setRefError(data.error);
      }
    } catch (err) {
      setRefError("Referral application failed.");
    } finally {
      setRefLoading(false);
    }
  };

  const filtered = bookings.filter((b) => TABS[tab].includes(b.status));

  if (loading && tab !== "referrals") {
    return <p className="max-w-4xl mx-auto px-5 py-10 text-asphalt/60">Loading bookings…</p>;
  }

  return (
    <div className="max-w-4xl mx-auto px-5 py-10">
      <h1 className="font-display text-2xl font-bold text-ink mb-6">My Bookings & Profile</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-black/10">
        {Object.keys(TABS).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition ${
              tab === t ? "border-signal text-ink" : "border-transparent text-asphalt/50 hover:text-ink"
            }`}
          >
            {t === "referrals" ? "🎁 Refer & Earn" : t}
          </button>
        ))}
      </div>

      {/* Refer & Earn Tab Content */}
      {tab === "referrals" && (
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-signal to-amber-500 rounded-3xl p-6 text-white shadow-lg">
            <h2 className="font-display text-xl font-bold mb-2">Invite Friends & Earn Wallet Balance!</h2>
            <p className="text-sm opacity-90 mb-6">Share your unique invite code. Both you and your friend will receive ₹50 inside your ParkIT wallets once they sign up!</p>
            
            <div className="flex flex-wrap gap-4 items-center justify-between bg-white/10 p-4 rounded-2xl border border-white/10">
              <div>
                <p className="text-xs uppercase tracking-wider opacity-85">Your Invite Code</p>
                <p className="font-mono text-2xl font-bold tracking-widest mt-1">
                  {referralStats?.referralCode || "..."}
                </p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(referralStats?.referralCode || "");
                  alert("Referral code copied to clipboard!");
                }}
                className="bg-white text-signal font-semibold text-xs rounded-full px-5 py-2.5 hover:bg-mist transition active:scale-95"
              >
                Copy Code
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Apply Referral Code */}
            <div className="bg-white border border-black/5 rounded-2xl p-6 shadow-sm">
              <h3 className="font-semibold text-sm text-ink mb-2">Enter referral code</h3>
              <p className="text-xs text-asphalt/50 mb-4">Did a friend invite you? Enter their code to redeem your ₹50 wallet credit.</p>
              
              <form onSubmit={handleApplyReferral} className="flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="e.g. ABC123D4"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  className="flex-1 border border-ink/15 rounded-xl px-3 py-2 text-xs uppercase"
                />
                <button
                  type="submit"
                  disabled={refLoading}
                  className="bg-ink hover:bg-ink/90 text-white font-bold text-xs rounded-xl px-4 py-2 transition disabled:opacity-50"
                >
                  {refLoading ? "Validating…" : "Claim ₹50"}
                </button>
              </form>
              {refSuccess && <p className="text-xs text-green-600 font-semibold mt-2">✓ {refSuccess}</p>}
              {refError && <p className="text-xs text-red-500 font-semibold mt-2">✗ {refError}</p>}
            </div>

            {/* Friends referred list */}
            <div className="bg-white border border-black/5 rounded-2xl p-6 shadow-sm">
              <h3 className="font-semibold text-sm text-ink mb-4 flex justify-between">
                <span>Referred Friends</span>
                <span className="text-xs bg-signal/15 text-signal px-2.5 py-0.5 rounded-full">
                  Total: {referralStats?.referralsCount || 0}
                </span>
              </h3>
              {referralStats?.referredFriends?.length === 0 ? (
                <p className="text-asphalt/50 text-xs py-4 text-center">No friends referred yet. Send your invite code now!</p>
              ) : (
                <div className="space-y-3 max-h-48 overflow-y-auto divide-y divide-black/5">
                  {referralStats?.referredFriends?.map((f, i) => (
                    <div key={i} className="flex justify-between items-center text-xs py-2">
                      <span className="font-semibold text-ink">{f.name}</span>
                      <span className="text-asphalt/50">{new Date(f.date).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bookings Lists */}
      {tab !== "referrals" && (
        <>
          {filtered.length === 0 && (
            <p className="text-asphalt/60 text-center py-10 bg-white rounded-2xl border border-black/5">No bookings found in this category.</p>
          )}

          <div className="space-y-6">
            {filtered.map((b) => {
              const area = b.parking_areas;
              const needsReview = b.status === "completed" && !reviewedBookingIds.has(b.id);

              return (
                <div key={b.id} className="bg-white rounded-2xl border border-black/5 p-5 shadow-sm hover:shadow-md transition relative">
                  {/* SOS Trigger button on active Checked-In bookings */}
                  {b.status === "checked_in" && (
                    <button
                      onClick={() => setSosBooking(b)}
                      className="absolute top-4 right-36 bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] px-3.5 py-1.5 rounded-full shadow-md z-10 animate-bounce active:scale-95 transition"
                    >
                      🚨 SOS Emergency
                    </button>
                  )}

                  <div className="flex items-start justify-between mb-4 border-b border-black/5 pb-3">
                    <div>
                      <h3 className="font-display font-semibold text-lg text-ink leading-tight">{area?.name}</h3>
                      <p className="text-xs text-asphalt/60 mt-1">{area?.address}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${statusStyles[b.status]}`}>
                      {b.status.replace("_", " ")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-4">
                    <div>
                      <p className="text-asphalt/50 text-[10px] uppercase font-bold">Start</p>
                      <p className="font-medium text-ink mt-0.5">{new Date(b.slot_start).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-asphalt/50 text-[10px] uppercase font-bold">End</p>
                      <p className="font-medium text-ink mt-0.5">{new Date(b.slot_end).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-asphalt/50 text-[10px] uppercase font-bold">Vehicle Type</p>
                      <p className="font-bold text-ink mt-0.5 uppercase">
                        {b.slot_type || "Car"} {b.has_ev_charging ? "⚡" : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-asphalt/50 text-[10px] uppercase font-bold">Payable</p>
                      <p className="font-semibold text-signal mt-0.5">₹{b.final_amount ?? b.amount}</p>
                    </div>
                  </div>

                  {/* Arrival deadlines */}
                  {b.status === "booked" && (
                    <div className="bg-mist px-4 py-2.5 rounded-xl text-xs flex justify-between items-center mb-4">
                      <span className="text-asphalt/60">Arrival grace period:</span>
                      <Countdown deadline={b.arrival_deadline} />
                    </div>
                  )}

                  {/* Live navigation map and QR card for entry */}
                  {b.status === "booked" && area?.latitude && area?.longitude && (
                    <div className="space-y-4">
                      {arrivedBanner.has(b.id) && (
                        <div className="bg-signal/15 text-signal text-xs font-semibold rounded-xl px-4 py-2.5 animate-pulse">
                          You've arrived nearby! Show the QR code below at the entry gate scan point.
                        </div>
                      )}
                      <LiveMap
                        destination={{ lat: area.latitude, lng: area.longitude, name: area.name }}
                        onArrival={() => handleNearby(b)}
                      />
                      <QRCodeCard qrToken={b.qr_token} label="Scan this at entry gate" />
                      <div className="flex gap-2">
                        <button
                          onClick={() => cancelBooking(b)}
                          className="flex-1 text-xs font-semibold border border-red-200 text-red-600 rounded-full py-2 hover:bg-red-50 transition"
                        >
                          Cancel Booking
                        </button>
                        <button
                          onClick={() => setActiveInvoice(b)}
                          className="flex-1 text-xs font-semibold bg-ink text-white rounded-full py-2 hover:bg-ink/90 transition"
                        >
                          View Invoice Receipt
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Checked In: show QR card for checkout exit */}
                  {b.status === "checked_in" && (
                    <div className="space-y-4">
                      <p className="text-xs text-asphalt/60">
                        Checked in at: <strong>{new Date(b.entry_time).toLocaleTimeString()}</strong>. Present the checkout QR at the exit scan.
                      </p>
                      <QRCodeCard qrToken={b.qr_token} label="Scan this at exit gate" />
                      <button
                        onClick={() => setActiveInvoice(b)}
                        className="w-full text-xs font-semibold border border-ink/15 rounded-full py-2 hover:bg-mist transition text-ink"
                      >
                        View Invoice Receipt
                      </button>
                    </div>
                  )}

                  {/* Completed Booking items */}
                  {b.status === "completed" && (
                    <div className="text-xs text-asphalt/70 space-y-3 pt-3 border-t border-black/5">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-asphalt/50 text-[10px] uppercase font-bold">Checked In At</p>
                          <p className="font-semibold text-ink mt-0.5">{b.entry_time ? new Date(b.entry_time).toLocaleString() : "—"}</p>
                        </div>
                        <div>
                          <p className="text-asphalt/50 text-[10px] uppercase font-bold">Checked Out At</p>
                          <p className="font-semibold text-ink mt-0.5">{b.exit_time ? new Date(b.exit_time).toLocaleString() : "—"}</p>
                        </div>
                      </div>
                      
                      {b.overtime_amount > 0 && (
                        <div className="bg-red-50 text-red-600 rounded-xl px-4 py-2 font-semibold">
                          Overtime charges: ₹{b.overtime_amount} (Settled in person with lot owner)
                        </div>
                      )}

                      <div className="flex gap-2">
                        {needsReview && (
                          <button
                            onClick={() => setReviewTarget(b)}
                            className="bg-signal text-white rounded-full px-5 py-2 text-xs font-bold hover:bg-signal/90 transition"
                          >
                            Leave a Review
                          </button>
                        )}
                        {reviewedBookingIds.has(b.id) && (
                          <span className="text-green-600 text-xs font-semibold py-2">✓ Review submitted</span>
                        )}
                        <button
                          onClick={() => setActiveInvoice(b)}
                          className="border border-ink/15 hover:bg-mist text-ink text-xs font-bold rounded-full px-5 py-2 transition ml-auto"
                        >
                          View Receipt
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <ReviewModal
          booking={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSubmitted={() => {
            setReviewTarget(null);
            fetchBookings();
          }}
        />
      )}

      {/* SOS Modal Drawer */}
      {sosBooking && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-display font-bold text-lg text-red-600 mb-2">🚨 Trigger SOS Alert</h3>
            <p className="text-xs text-asphalt/60 mb-4">This sends a high-priority security alert to the parking owner and platform administrator.</p>

            {sosMsg && <p className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-xl px-3 py-2 mb-4 font-semibold">{sosMsg}</p>}

            <label className="text-xs font-bold uppercase text-asphalt/60 block mb-1">Incident Type</label>
            <select
              value={sosType}
              onChange={(e) => setSosType(e.target.value)}
              className="w-full border border-ink/15 rounded-xl px-3 py-2 text-sm bg-white mb-4"
            >
              <option value="need_assistance">Need Assistance</option>
              <option value="vehicle_damaged">Vehicle Damaged / Vandalized</option>
              <option value="emergency">Medical / Fire / Security Emergency</option>
            </select>

            <label className="text-xs font-bold uppercase text-asphalt/60 block mb-1">Details (Optional)</label>
            <textarea
              rows="3"
              placeholder="e.g. My car got scratched, need staff assistance at Slot 5"
              value={sosDetails}
              onChange={(e) => setSosDetails(e.target.value)}
              className="w-full border border-ink/15 rounded-xl px-3 py-2 text-xs mb-4"
            />

            <div className="flex gap-2">
              <button
                disabled={sosLoading}
                onClick={() => setSosBooking(null)}
                className="flex-1 border border-ink/15 rounded-full py-2 text-xs font-bold hover:bg-mist text-ink"
              >
                Cancel
              </button>
              <button
                disabled={sosLoading}
                onClick={handleTriggerSos}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-full py-2 text-xs font-bold transition"
              >
                {sosLoading ? "Sending Alert…" : "Broadcast SOS"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Viewer Modal */}
      {activeInvoice && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl relative">
            <button
              onClick={() => setActiveInvoice(null)}
              className="absolute top-4 right-4 text-asphalt/40 hover:text-ink text-xl"
            >
              ×
            </button>
            
            <div className="text-center mb-6">
              <span className="text-2xl">📋</span>
              <h3 className="font-display font-bold text-lg text-ink mt-2">Invoice Receipt</h3>
              <p className="text-[10px] text-asphalt/40 font-mono mt-0.5">ID: {activeInvoice.id}</p>
            </div>

            <div className="space-y-3 text-xs mb-6 border-b border-black/5 pb-4">
              <div className="flex justify-between"><span className="text-asphalt/50">Parking Lot:</span><span className="font-semibold text-ink">{activeInvoice.parking_areas?.name}</span></div>
              <div className="flex justify-between"><span className="text-asphalt/50">Address:</span><span className="text-ink text-right max-w-[200px]">{activeInvoice.parking_areas?.address}</span></div>
              <div className="flex justify-between"><span className="text-asphalt/50">Slot Type:</span><span className="font-bold text-ink uppercase">{activeInvoice.slot_type}</span></div>
              {activeInvoice.has_ev_charging && <div className="flex justify-between"><span className="text-asphalt/50">EV Charging:</span><span className="text-emerald-600 font-bold">Yes (Add-on applied)</span></div>}
              <div className="flex justify-between"><span className="text-asphalt/50">Start Time:</span><span className="text-ink">{new Date(activeInvoice.slot_start).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-asphalt/50">End Time:</span><span className="text-ink">{new Date(activeInvoice.slot_end).toLocaleString()}</span></div>
              {activeInvoice.applied_coupon && <div className="flex justify-between"><span className="text-asphalt/50">Coupon Applied:</span><span className="text-green-600 font-bold uppercase">{activeInvoice.applied_coupon}</span></div>}
              {activeInvoice.discount_amount > 0 && <div className="flex justify-between"><span className="text-asphalt/50">Discount value:</span><span className="text-green-600 font-semibold">- ₹{activeInvoice.discount_amount}</span></div>}
            </div>

            <div className="flex justify-between items-center text-sm font-bold text-signal mb-6">
              <span>Total Paid Amount:</span>
              <span className="text-lg">₹{activeInvoice.final_amount ?? activeInvoice.amount}</span>
            </div>

            <div className="bg-mist p-4 rounded-2xl flex flex-col items-center text-center">
              <p className="text-[10px] text-asphalt/50 mb-2">Invoice generated. Local copies are stored in the server.</p>
              <a
                href={`${PAYMENT_SERVER_URL}/uploads/receipts/invoice_${activeInvoice.id}.html`}
                target="_blank"
                rel="noreferrer"
                className="bg-ink hover:bg-ink/90 text-white text-xs font-bold rounded-full px-6 py-2 transition"
              >
                Download Invoice HTML
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
