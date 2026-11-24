import { useState, useEffect } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;
const GRACE_PERIOD_MINUTES = 15;

export default function BookingModal({ area, onClose, onSuccess }) {
  const { session, profile } = useAuth();
  
  // Selections
  const [hours, setHours] = useState(1);
  const [slotType, setSlotType] = useState("car");
  const [hasEvCharging, setHasEvCharging] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [paymentMode, setPaymentMode] = useState("razorpay"); // 'razorpay' or 'wallet'

  // Available slots for this lot
  const [slotsList, setSlotsList] = useState([]);
  
  // Cost breakdown states
  const [pricing, setPricing] = useState(null);
  const [couponApplied, setCouponApplied] = useState("");
  const [couponError, setCouponError] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch slot types and capacity for this parking area
  useEffect(() => {
    const fetchSlots = async () => {
      const { data, error } = await supabase
        .from("parking_slots")
        .select("*")
        .eq("parking_area_id", area.id);
      if (!error && data) {
        setSlotsList(data);
        // Pre-select first available slot type
        const available = data.find(s => s.available_slots > 0);
        if (available) setSlotType(available.slot_type);
      }
    };
    fetchSlots();
  }, [area.id]);

  // Call backend to calculate pricing breakdown dynamically
  const fetchPriceBreakdown = async () => {
    setPricingLoading(true);
    setCouponError("");
    try {
      const slotStart = new Date();
      const slotEnd = new Date(slotStart.getTime() + hours * 60 * 60 * 1000);

      const res = await fetch(`${PAYMENT_SERVER_URL}/api/payment/calculate-cost`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          slotType,
          hasEvCharging,
          couponCode: couponCode ? couponCode.trim().toUpperCase() : null,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setPricing(data);
        if (couponCode) {
          if (data.couponApplied) {
            setCouponApplied(data.couponApplied);
          } else if (data.couponError) {
            setCouponError(data.couponError);
            setCouponApplied("");
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPricingLoading(false);
    }
  };

  useEffect(() => {
    fetchPriceBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, slotType, hasEvCharging]);

  const handleApplyCoupon = (e) => {
    e.preventDefault();
    fetchPriceBreakdown();
  };

  const handleBookAndPay = async () => {
    setLoading(true);
    setError("");
    try {
      const slotStart = new Date();
      const slotEnd = new Date(slotStart.getTime() + hours * 60 * 60 * 1000);
      const arrivalDeadline = new Date(slotStart.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);

      // 1. Create a pending_payment booking row
      const { data: booking, error: insertErr } = await supabase
        .from("bookings")
        .insert({
          user_id: session.user.id,
          parking_area_id: area.id,
          slot_start: slotStart.toISOString(),
          slot_end: slotEnd.toISOString(),
          arrival_deadline: arrivalDeadline.toISOString(),
          amount: pricing?.finalAmount || (hours * area.price_per_hour),
          status: "pending_payment",
          payment_status: "pending",
          slot_type: slotType,
          has_ev_charging: hasEvCharging,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // 2. Decide payment route: Rider Wallet or Razorpay
      if (paymentMode === "wallet") {
        const walletRes = await fetch(`${PAYMENT_SERVER_URL}/api/payment/pay-with-wallet`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            bookingId: booking.id,
            couponCode: couponApplied || null
          })
        });
        
        const walletData = await walletRes.json();
        if (!walletRes.ok) throw new Error(walletData.error || "Wallet payment failed");
        onSuccess();
      } else {
        // Razorpay Checkout flow
        const orderRes = await fetch(`${PAYMENT_SERVER_URL}/api/payment/create-order`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            bookingId: booking.id,
            couponCode: couponApplied || null
          }),
        });
        
        const order = await orderRes.json();
        if (!orderRes.ok) throw new Error(order.error || "Could not initialize payment order");

        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: "ParkIT",
          description: `${area.name} — ${hours}hr ${slotType.toUpperCase()}`,
          order_id: order.orderId,
          handler: async function (response) {
            const verifyRes = await fetch(`${PAYMENT_SERVER_URL}/api/payment/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                bookingId: booking.id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              onSuccess();
            } else {
              setError("Payment signature verification failed. Contact support.");
            }
          },
          theme: { color: "#FF6B35" },
          modal: { ondismiss: () => setLoading(false) },
        };

        const rzp = new window.Razorpay(options);
        rzp.open();
      }
    } catch (err) {
      setError(err.message || "Failed to process booking");
      setLoading(false);
    }
  };

  const selectedSlotConfig = slotsList.find(s => s.slot_type === slotType);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl animate-scaleUp overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-display font-bold text-xl text-ink leading-tight">{area.name}</h3>
          <button onClick={onClose} className="text-asphalt/40 hover:text-ink text-xl">×</button>
        </div>
        <p className="text-xs text-asphalt/60 mb-5">{area.address}</p>

        {/* 1. Vehicle Slot Type Picker */}
        <label className="text-xs font-bold uppercase text-asphalt/60 block mb-2">Select Vehicle Type</label>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {["bike", "car", "suv", "ev", "truck"].map((type) => {
            const config = slotsList.find((s) => s.slot_type === type);
            const isAvailable = config && config.available_slots > 0;
            return (
              <button
                key={type}
                type="button"
                disabled={!isAvailable}
                onClick={() => {
                  setSlotType(type);
                  if (type !== "ev") setHasEvCharging(false);
                }}
                className={`py-2 px-1 rounded-xl text-[10px] font-bold border transition uppercase flex flex-col items-center gap-1 ${
                  slotType === type
                    ? "bg-signal/10 border-signal text-signal"
                    : "border-black/5 hover:bg-mist text-asphalt"
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                <span>
                  {type === "bike" ? "🏍️" : type === "car" ? "🚗" : type === "suv" ? "🚙" : type === "ev" ? "⚡" : "🚛"}
                </span>
                <span>{type}</span>
                <span className="text-[8px] text-asphalt/40">
                  {config ? `₹${config.price_per_hour.toFixed(0)}` : "N/A"}
                </span>
              </button>
            );
          })}
        </div>

        {selectedSlotConfig && (
          <p className="text-[10px] text-asphalt/50 mb-4 -mt-2">
            Available: <strong>{selectedSlotConfig.available_slots} slots</strong> · Base Rate: ₹{selectedSlotConfig.price_per_hour}/hr
          </p>
        )}

        {/* 2. Duration */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <label className="text-xs font-bold uppercase text-asphalt/60 block mb-1">Duration (Hours)</label>
            <input
              type="number"
              min="1"
              max="24"
              value={hours}
              onChange={(e) => setHours(Math.max(1, Math.min(24, Number(e.target.value))))}
              className="w-full border border-ink/15 rounded-xl px-3 py-2 text-sm bg-white"
            />
          </div>

          {/* 3. EV Charging Addon (EV slots only) */}
          {slotType === "ev" && (
            <div className="flex-1 flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer bg-emerald-50 border border-emerald-100 p-2.5 rounded-xl">
                <input
                  type="checkbox"
                  checked={hasEvCharging}
                  onChange={(e) => setHasEvCharging(e.target.checked)}
                  className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <div>
                  <p className="text-[11px] leading-tight">⚡ charging Addon</p>
                  <p className="text-[9px] text-emerald-700 font-bold">+ ₹100 flat</p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* 4. Coupon Code */}
        <form onSubmit={handleApplyCoupon} className="mb-4">
          <label className="text-xs font-bold uppercase text-asphalt/60 block mb-1">Have a coupon code?</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. FIRST50, SAVE20"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              className="flex-1 border border-ink/15 rounded-xl px-3 py-1.5 text-xs uppercase"
            />
            <button
              type="submit"
              className="bg-ink hover:bg-ink/90 text-white text-xs font-bold px-4 py-2 rounded-xl transition"
            >
              Apply
            </button>
          </div>
          {couponApplied && <p className="text-[10px] text-green-600 font-semibold mt-1">✓ Coupon code "{couponApplied}" applied successfully!</p>}
          {couponError && <p className="text-[10px] text-red-500 font-semibold mt-1">✗ {couponError}</p>}
        </form>

        {/* 5. Dynamic Pricing Details table */}
        {pricingLoading ? (
          <div className="text-center py-4 text-xs text-asphalt/40">Calculating dynamic peak pricing…</div>
        ) : pricing ? (
          <div className="bg-mist rounded-2xl p-4 text-xs mb-5 space-y-2">
            <div className="flex justify-between font-bold text-ink border-b border-black/5 pb-2 mb-2">
              <span>Dynamic Price Breakdown</span>
              <span>Hourly Rate</span>
            </div>
            {pricing.hourlyDetails.map((h, index) => (
              <div key={index} className="flex justify-between text-asphalt/70">
                <span>Hour {index + 1}: {h.hour} ({h.block.split(" ")[0]})</span>
                <span>₹{h.rateForHour.toFixed(2)}</span>
              </div>
            ))}
            {pricing.evChargeAddon > 0 && (
              <div className="flex justify-between text-emerald-600 font-medium">
                <span>⚡ EV Charging addon</span>
                <span>+ ₹{pricing.evChargeAddon.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium text-ink pt-2 border-t border-black/5">
              <span>Gross Fee:</span>
              <span>₹{pricing.grossAmount.toFixed(2)}</span>
            </div>
            {pricing.discountAmount > 0 && (
              <div className="flex justify-between text-green-600 font-semibold">
                <span>Discount Applied:</span>
                <span>- ₹{pricing.discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-signal pt-1">
              <span>Final Payable:</span>
              <span>₹{pricing.finalAmount.toFixed(2)}</span>
            </div>
          </div>
        ) : null}

        {/* 6. Select Payment Mode */}
        <label className="text-xs font-bold uppercase text-asphalt/60 block mb-2">Payment Method</label>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            type="button"
            onClick={() => setPaymentMode("razorpay")}
            className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
              paymentMode === "razorpay" ? "border-signal bg-signal/5 text-signal" : "border-black/5 hover:bg-mist text-asphalt"
            }`}
          >
            <span>💳 Razorpay Pay</span>
            <span className="text-[9px] text-asphalt/50 font-normal">UPI, Cards, Netbanking</span>
          </button>
          
          <button
            type="button"
            onClick={() => setPaymentMode("wallet")}
            className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
              paymentMode === "wallet" ? "border-signal bg-signal/5 text-signal" : "border-black/5 hover:bg-mist text-asphalt"
            }`}
          >
            <span>👛 Rider Wallet</span>
            <span className="text-[9px] text-asphalt/50 font-normal">
              Balance: ₹{Number(profile?.wallet_balance || 0).toFixed(0)}
            </span>
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-2.5 mb-4 text-xs font-semibold">{error}</div>}

        {/* 7. Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-ink/15 rounded-full py-2.5 text-xs font-bold hover:bg-mist text-ink"
          >
            Cancel
          </button>
          <button
            onClick={handleBookAndPay}
            disabled={loading || pricingLoading}
            className="flex-1 bg-signal text-white rounded-full py-2.5 text-xs font-bold hover:bg-signal/90 disabled:opacity-50 transition"
          >
            {loading ? "Processing…" : paymentMode === "wallet" ? "Pay via Wallet" : "Pay & Book"}
          </button>
        </div>

        <p className="text-[10px] text-asphalt/40 text-center mt-4">
          Arrive within {GRACE_PERIOD_MINUTES} minutes of your booking start time or it will be automatically cancelled.
        </p>
      </div>
    </div>
  );
}
