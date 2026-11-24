const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

let razorpay;
try {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_mock",
    key_secret: process.env.RAZORPAY_KEY_SECRET || "mock_secret",
  });
} catch (err) {
  console.log("Razorpay init placeholder", err.message);
}

const PLATFORM_COMMISSION_PERCENT = Number(process.env.PLATFORM_COMMISSION_PERCENT || 15);

// Helper function to calculate peak-hour and vehicle pricing
function calculateAmount(startTimeStr, endTimeStr, slotType = "car", hasEvCharging = false) {
  const start = new Date(startTimeStr);
  const end = new Date(endTimeStr);
  const durationHours = Math.ceil((end - start) / (3600 * 1000)) || 1;

  let total = 0;
  let currentTime = new Date(start);
  const hourlyDetails = [];

  for (let i = 0; i < durationHours; i++) {
    const hourOfDay = currentTime.getHours();
    let hourlyRate = 20; // Default Morning rate
    let timeBlock = "Morning (6 AM - 5 PM)";

    if (hourOfDay >= 6 && hourOfDay < 17) {
      hourlyRate = 20;
      timeBlock = "Morning (6 AM - 5 PM)";
    } else if (hourOfDay >= 17 && hourOfDay < 22) {
      hourlyRate = 50;
      timeBlock = "Evening Peak (5 PM - 10 PM)";
    } else {
      hourlyRate = 15;
      timeBlock = "Night (10 PM - 6 AM)";
    }

    // Apply vehicle type multiplier
    let multiplier = 1.0;
    if (slotType === "bike") multiplier = 0.5;
    else if (slotType === "suv") multiplier = 1.5;
    else if (slotType === "ev") multiplier = 1.2;
    else if (slotType === "truck") multiplier = 2.5;

    const rateForHour = hourlyRate * multiplier;
    total += rateForHour;

    hourlyDetails.push({
      hour: currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      block: timeBlock,
      baseRate: hourlyRate,
      multiplier,
      rateForHour
    });

    currentTime.setHours(currentTime.getHours() + 1);
  }

  if (hasEvCharging) {
    total += 100; // flat ₹100 charging reservation fee
  }

  return {
    grossAmount: Math.round(total * 100) / 100,
    durationHours,
    hourlyDetails,
    evChargeAddon: hasEvCharging ? 100 : 0
  };
}

// Helper to save HTML Invoice receipt
async function saveReceiptInvoice(booking, area, profile, discountAmount, finalAmount, pricingDetails) {
  try {
    const receiptsDir = path.join(__dirname, "../receipts");
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invoice - Booking #${booking.id.substring(0, 8)}</title>
      <style>
        body { font-family: 'Inter', sans-serif; color: #1E293B; line-height: 1.5; padding: 40px; background: #F8FAFC; }
        .invoice-card { max-width: 600px; margin: 0 auto; background: white; border: 1px solid #E2E8F0; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #F1F5F9; padding-bottom: 20px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: 800; color: #FF6B35; }
        .title { font-size: 14px; text-transform: uppercase; color: #64748B; font-weight: 600; }
        .details-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .details-grid div h4 { margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; color: #94A3B8; }
        .details-grid div p { margin: 0; font-size: 14px; font-weight: 500; }
        .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .table th { text-align: left; padding: 12px; background: #F1F5F9; font-size: 12px; text-transform: uppercase; color: #64748B; }
        .table td { padding: 12px; border-bottom: 1px solid #F1F5F9; font-size: 14px; }
        .total-section { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
        .total-row { display: flex; justify-content: space-between; width: 250px; font-size: 14px; color: #64748B; }
        .grand-total { font-size: 20px; font-weight: 800; color: #FF6B35; border-top: 2px solid #F1F5F9; padding-top: 10px; margin-top: 5px; }
        .qr-section { text-align: center; margin-top: 30px; border-top: 1px dashed #E2E8F0; padding-top: 20px; }
        .qr-token { font-family: monospace; background: #F1F5F9; padding: 8px 16px; border-radius: 6px; font-size: 14px; letter-spacing: 1px; display: inline-block; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="invoice-card">
        <div class="header">
          <div class="logo">🅿️ ParkIT</div>
          <div class="title">Official Invoice</div>
        </div>
        <div class="details-grid">
          <div>
            <h4>Billed To</h4>
            <p>${profile.full_name}</p>
            <p>${profile.phone || "No phone"}</p>
          </div>
          <div>
            <h4>Parking Lot Details</h4>
            <p><strong>${area.name}</strong></p>
            <p>${area.address}, ${area.city}</p>
          </div>
        </div>
        <div class="details-grid">
          <div>
            <h4>Slot Start</h4>
            <p>${new Date(booking.slot_start).toLocaleString()}</p>
          </div>
          <div>
            <h4>Slot End</h4>
            <p>${new Date(booking.slot_end).toLocaleString()}</p>
          </div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Vehicle</th>
              <th>Duration</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Parking Area Space Reservation</td>
              <td>${booking.slot_type?.toUpperCase()}</td>
              <td>${pricingDetails.durationHours} hr(s)</td>
              <td>Base rates apply (Dynamic Pricing)</td>
            </tr>
            ${booking.has_ev_charging ? `<tr><td>EV Charging Slot Reservation Add-on</td><td>EV</td><td>Flat</td><td>₹100.00</td></tr>` : ""}
          </tbody>
        </table>
        <div class="total-section">
          <div class="total-row"><span>Gross Amount:</span><span>₹${pricingDetails.grossAmount}</span></div>
          ${discountAmount > 0 ? `<div class="total-row"><span>Coupon Applied (${booking.applied_coupon || "Discount"}):</span><span>- ₹${discountAmount}</span></div>` : ""}
          <div class="total-row grand-total"><span>Amount Paid:</span><span>₹${finalAmount}</span></div>
        </div>
        <div class="qr-section">
          <p style="margin: 0; font-size: 13px; color: #64748B;">Show this entry token QR code at the parking gate:</p>
          <div class="qr-token">${booking.qr_token}</div>
        </div>
      </div>
    </body>
    </html>
    `;

    const filepath = path.join(receiptsDir, `invoice_${booking.id}.html`);
    fs.writeFileSync(filepath, htmlContent);
    console.log(`✉️ invoice receipt saved successfully to ${filepath}`);

    // Mock NodeMailer Send Log
    console.log("================ MOCK EMAIL SEND ================");
    console.log(`TO: ${profile.email || "customer@example.com"}`);
    console.log(`SUBJECT: Booking Confirmed & Receipt - Invoice #${booking.id.substring(0, 8)}`);
    console.log(`BODY: Thank you for booking with ParkIT! Find your receipt details attached at: ${filepath}`);
    console.log("=================================================");
  } catch (err) {
    console.error("Failed to generate HTML receipt invoice:", err.message);
  }
}

// ------------------------------------------------------------------
// POST /api/payment/calculate-cost
// Body: { startTime, endTime, slotType, hasEvCharging, couponCode }
// Calculates cost estimate and discount for frontend
// ------------------------------------------------------------------
router.post("/calculate-cost", async (req, res) => {
  try {
    const { startTime, endTime, slotType, hasEvCharging, couponCode } = req.body;
    if (!startTime || !endTime) return res.status(400).json({ error: "startTime and endTime are required" });

    const pricing = calculateAmount(startTime, endTime, slotType, hasEvCharging);
    
    let discountAmount = 0;
    let couponApplied = null;
    let errorMsg = null;

    if (couponCode) {
      const { data: coupon } = await supabaseAdmin
        .from("coupons")
        .select("*")
        .eq("code", couponCode.trim().toUpperCase())
        .single();

      if (coupon && coupon.is_active && (!coupon.expiry_date || new Date(coupon.expiry_date) > new Date())) {
        const minAmount = Number(coupon.min_booking_amount || 0);
        if (pricing.grossAmount >= minAmount) {
          couponApplied = coupon.code;
          if (coupon.discount_type === "flat") {
            discountAmount = Number(coupon.discount_value);
          } else if (coupon.discount_type === "percentage") {
            discountAmount = Math.round(pricing.grossAmount * (Number(coupon.discount_value) / 100) * 100) / 100;
          }
          if (discountAmount > pricing.grossAmount) discountAmount = pricing.grossAmount;
        } else {
          errorMsg = `Min amount for ${coupon.code} is ₹${minAmount}`;
        }
      } else {
        errorMsg = "Coupon code invalid or expired";
      }
    }

    const finalAmount = Math.round((pricing.grossAmount - discountAmount) * 100) / 100;

    res.json({
      grossAmount: pricing.grossAmount,
      discountAmount,
      finalAmount,
      evChargeAddon: pricing.evChargeAddon,
      durationHours: pricing.durationHours,
      hourlyDetails: pricing.hourlyDetails,
      couponApplied,
      couponError: errorMsg
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Pricing calculation error" });
  }
});

// ------------------------------------------------------------------
// POST /api/payment/create-order
// ------------------------------------------------------------------
router.post("/create-order", async (req, res) => {
  try {
    const { bookingId, couponCode } = req.body;
    if (!bookingId) return res.status(400).json({ error: "bookingId is required" });

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("*, parking_areas(*)")
      .eq("id", bookingId)
      .single();

    if (error || !booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.payment_status === "paid") return res.status(400).json({ error: "Booking already paid" });

    // 1. Check for Duplicate active Bookings overlapping the exact same time window
    const { data: duplicateCheck } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("user_id", booking.user_id)
      .eq("payment_status", "paid")
      .in("status", ["booked", "checked_in"])
      .neq("id", bookingId)
      .filter("slot_start", "lt", booking.slot_end)
      .filter("slot_end", "gt", booking.slot_start);

    if (duplicateCheck && duplicateCheck.length > 0) {
      return res.status(400).json({ 
        error: "FRAUD DETECTED: You already have an active paid booking that overlaps with this time slot." 
      });
    }

    // 2. Perform spam limit check (max 5 active/paid bookings in a single day)
    const startOfToday = new Date();
    startOfToday.setHours(0,0,0,0);
    const { count: dailyBookingCount } = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", booking.user_id)
      .eq("payment_status", "paid")
      .gte("created_at", startOfToday.toISOString());

    if (dailyBookingCount && dailyBookingCount >= 5) {
      return res.status(400).json({ 
        error: "RATE LIMIT EXCEEDED: You can book a maximum of 5 parking slots per day to prevent spam booking." 
      });
    }

    // 3. Check if owner is approved before allowing rider booking!
    const { data: ownerProfile } = await supabaseAdmin
      .from("profiles")
      .select("is_approved")
      .eq("id", booking.parking_areas.owner_id)
      .single();

    if (!ownerProfile || !ownerProfile.is_approved) {
      return res.status(400).json({ 
        error: "This parking lot is currently unavailable because the owner is awaiting administrator approval." 
      });
    }

    // 4. Calculate dynamic amount
    const pricing = calculateAmount(booking.slot_start, booking.slot_end, booking.slot_type, booking.has_ev_charging);
    
    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const { data: coupon } = await supabaseAdmin
        .from("coupons")
        .select("*")
        .eq("code", couponCode.trim().toUpperCase())
        .single();

      if (coupon && coupon.is_active && (!coupon.expiry_date || new Date(coupon.expiry_date) > new Date())) {
        const minAmount = Number(coupon.min_booking_amount || 0);
        if (pricing.grossAmount >= minAmount) {
          appliedCoupon = coupon.code;
          if (coupon.discount_type === "flat") {
            discountAmount = Number(coupon.discount_value);
          } else if (coupon.discount_type === "percentage") {
            discountAmount = Math.round(pricing.grossAmount * (Number(coupon.discount_value) / 100) * 100) / 100;
          }
          if (discountAmount > pricing.grossAmount) discountAmount = pricing.grossAmount;
        }
      }
    }

    const finalAmount = Math.round((pricing.grossAmount - discountAmount) * 100) / 100;

    // platform split calculations
    const platformFeeAmount = Math.round(finalAmount * (PLATFORM_COMMISSION_PERCENT / 100) * 100) / 100;
    const ownerPayoutAmount = Math.round((finalAmount - platformFeeAmount) * 100) / 100;

    let order = { id: "order_mock_" + Math.random().toString(36).substring(7), amount: finalAmount * 100, currency: "INR" };

    if (razorpay) {
      try {
        order = await razorpay.orders.create({
          amount: Math.round(finalAmount * 100), // paise
          currency: "INR",
          receipt: booking.id.replace(/-/g, "").substring(0, 40),
          notes: { booking_id: booking.id },
        });
      } catch (e) {
        console.log("Fallback mock order created (Razorpay credentials missing/invalid)");
      }
    }

    await supabaseAdmin
      .from("bookings")
      .update({
        razorpay_order_id: order.id,
        amount: finalAmount,
        platform_fee_amount: platformFeeAmount,
        owner_payout_amount: ownerPayoutAmount,
        applied_coupon: appliedCoupon,
        discount_amount: discountAmount,
      })
      .eq("id", bookingId);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_mock",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ------------------------------------------------------------------
// POST /api/payment/pay-with-wallet
// Auth: verified session token (rider)
// Body: { bookingId, couponCode }
// Allows riders to pay instantly using their rider wallet balance.
// ------------------------------------------------------------------
router.post("/pay-with-wallet", requireAuth, async (req, res) => {
  try {
    const { bookingId, couponCode } = req.body;
    if (!bookingId) return res.status(400).json({ error: "bookingId is required" });

    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select("*, parking_areas(*)")
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.payment_status === "paid") return res.status(400).json({ error: "Booking already paid" });
    if (booking.user_id !== req.userId) return res.status(403).json({ error: "Access denied" });

    // 1. Perform duplicate check
    const { data: duplicateCheck } = await supabaseAdmin
      .from("bookings")
      .select("id")
      .eq("user_id", req.userId)
      .eq("payment_status", "paid")
      .in("status", ["booked", "checked_in"])
      .neq("id", bookingId)
      .filter("slot_start", "lt", booking.slot_end)
      .filter("slot_end", "gt", booking.slot_start);

    if (duplicateCheck && duplicateCheck.length > 0) {
      return res.status(400).json({ error: "You already have an active overlapping booking." });
    }

    // 2. Load rider profile for wallet balance check
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance, full_name, phone")
      .eq("id", req.userId)
      .single();

    if (pErr || !profile) return res.status(404).json({ error: "Profile not found" });

    // Calculate dynamic cost
    const pricing = calculateAmount(booking.slot_start, booking.slot_end, booking.slot_type, booking.has_ev_charging);
    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const { data: coupon } = await supabaseAdmin
        .from("coupons")
        .select("*")
        .eq("code", couponCode.trim().toUpperCase())
        .single();

      if (coupon && coupon.is_active && (!coupon.expiry_date || new Date(coupon.expiry_date) > new Date())) {
        const minAmount = Number(coupon.min_booking_amount || 0);
        if (pricing.grossAmount >= minAmount) {
          appliedCoupon = coupon.code;
          if (coupon.discount_type === "flat") {
            discountAmount = Number(coupon.discount_value);
          } else if (coupon.discount_type === "percentage") {
            discountAmount = Math.round(pricing.grossAmount * (Number(coupon.discount_value) / 100) * 100) / 100;
          }
          if (discountAmount > pricing.grossAmount) discountAmount = pricing.grossAmount;
        }
      }
    }

    const finalAmount = Math.round((pricing.grossAmount - discountAmount) * 100) / 100;

    if (Number(profile.wallet_balance) < finalAmount) {
      return res.status(400).json({ 
        error: `Insufficient wallet balance. Total cost is ₹${finalAmount}, but your balance is ₹${profile.wallet_balance}.` 
      });
    }

    // platform split calculations
    const platformFeeAmount = Math.round(finalAmount * (PLATFORM_COMMISSION_PERCENT / 100) * 100) / 100;
    const ownerPayoutAmount = Math.round((finalAmount - platformFeeAmount) * 100) / 100;

    // Deduct from rider's wallet
    const newRiderBalance = Number(profile.wallet_balance) - finalAmount;
    await supabaseAdmin
      .from("profiles")
      .update({ wallet_balance: newRiderBalance })
      .eq("id", req.userId);

    // Update booking row
    const { data: updatedBooking } = await supabaseAdmin
      .from("bookings")
      .update({
        payment_status: "paid",
        status: "booked",
        amount: finalAmount,
        platform_fee_amount: platformFeeAmount,
        owner_payout_amount: ownerPayoutAmount,
        applied_coupon: appliedCoupon,
        discount_amount: discountAmount,
      })
      .eq("id", bookingId)
      .select()
      .single();

    // Credit owner wallet
    const { error: creditErr } = await supabaseAdmin.rpc("credit_owner_wallet", {
      p_booking_id: bookingId,
    });
    if (creditErr) console.error("Wallet credit failed:", creditErr.message);

    // Decrement available slots in parking_slots table for vehicle type
    const { data: slotConfig } = await supabaseAdmin
      .from("parking_slots")
      .select("available_slots")
      .eq("parking_area_id", booking.parking_area_id)
      .eq("slot_type", booking.slot_type)
      .single();

    if (slotConfig && slotConfig.available_slots > 0) {
      await supabaseAdmin
        .from("parking_slots")
        .update({ available_slots: slotConfig.available_slots - 1 })
        .eq("parking_area_id", booking.parking_area_id)
        .eq("slot_type", booking.slot_type);
      
      // Update aggregate counts
      const { data: area } = await supabaseAdmin
        .from("parking_areas")
        .select("available_slots")
        .eq("id", booking.parking_area_id)
        .single();
      if (area && area.available_slots > 0) {
        await supabaseAdmin
          .from("parking_areas")
          .update({ available_slots: area.available_slots - 1 })
          .eq("id", booking.parking_area_id);
      }
    }

    // Generate Invoice HTML
    await saveReceiptInvoice(updatedBooking, booking.parking_areas, profile, discountAmount, finalAmount, pricing);

    // Add confirmation notifications
    await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: req.userId,
        title: "Booking Confirmed! 🅿️",
        message: `Your booking at ${booking.parking_areas.name} has been confirmed. Paid ₹${finalAmount} via Wallet.`,
      });

    res.json({ success: true, message: "Booking paid successfully using Wallet!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Wallet payment processing failed" });
  }
});

// ------------------------------------------------------------------
// POST /api/payment/verify
// ------------------------------------------------------------------
router.post("/verify", async (req, res) => {
  try {
    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    let signatureValid = true;
    if (razorpay_signature && !razorpay_order_id.startsWith("order_mock_")) {
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        signatureValid = false;
      }
    }

    if (!signatureValid) {
      return res.status(400).json({ error: "Payment verification failed: invalid signature" });
    }

    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select("*, parking_areas(*)")
      .eq("id", bookingId)
      .single();
    if (bErr || !booking) return res.status(404).json({ error: "Booking not found" });

    // Mark booking paid + booked
    const { data: updatedBooking } = await supabaseAdmin
      .from("bookings")
      .update({
        payment_status: "paid",
        status: "booked",
        razorpay_payment_id: razorpay_payment_id || "mock_payment_" + Math.random().toString(36).substring(7),
      })
      .eq("id", bookingId)
      .select()
      .single();

    // Credit owner wallet
    const { error: creditErr } = await supabaseAdmin.rpc("credit_owner_wallet", {
      p_booking_id: bookingId,
    });
    if (creditErr) console.error("Wallet credit failed:", creditErr.message);

    // Decrement available slots in parking_slots table for vehicle type
    const { data: slotConfig } = await supabaseAdmin
      .from("parking_slots")
      .select("available_slots")
      .eq("parking_area_id", booking.parking_area_id)
      .eq("slot_type", booking.slot_type)
      .single();

    if (slotConfig && slotConfig.available_slots > 0) {
      await supabaseAdmin
        .from("parking_slots")
        .update({ available_slots: slotConfig.available_slots - 1 })
        .eq("parking_area_id", booking.parking_area_id)
        .eq("slot_type", booking.slot_type);
      
      // Update aggregate counts
      const { data: area } = await supabaseAdmin
        .from("parking_areas")
        .select("available_slots")
        .eq("id", booking.parking_area_id)
        .single();
      if (area && area.available_slots > 0) {
        await supabaseAdmin
          .from("parking_areas")
          .update({ available_slots: area.available_slots - 1 })
          .eq("id", booking.parking_area_id);
      }
    }

    // Get rider profile details
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", booking.user_id)
      .single();

    const pricing = {
      grossAmount: Number(booking.amount) + Number(booking.discount_amount || 0),
      durationHours: Math.ceil((new Date(booking.slot_end) - new Date(booking.slot_start)) / (3600 * 1000)),
    };

    if (profile) {
      await saveReceiptInvoice(
        updatedBooking,
        booking.parking_areas,
        profile,
        booking.discount_amount || 0,
        booking.amount,
        pricing
      );

      // Create notifications
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: booking.user_id,
          title: "Booking Confirmed! 🅿️",
          message: `Your booking at ${booking.parking_areas.name} has been confirmed. Paid ₹${booking.amount} via UPI/Card.`,
        });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Payment verification error" });
  }
});

module.exports = router;
