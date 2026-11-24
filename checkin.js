const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/checkin/scan-entry
// Auth: owner's Supabase session token
// Body: { qrToken }
// The rider shows their QR (generated from their booking's qr_token) at the
// gate. The owner scans it with their phone camera. This looks the booking
// up by that token, confirms it belongs to a parking area THIS owner
// actually owns (stops one owner checking in bookings at someone else's
// lot), confirms it's paid and not already checked in, then marks entry.
// ------------------------------------------------------------------
router.post("/scan-entry", requireAuth, async (req, res) => {
  try {
    const { qrToken } = req.body;
    if (!qrToken) return res.status(400).json({ error: "qrToken is required" });

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("*, parking_areas(id, name, owner_id)")
      .eq("qr_token", qrToken)
      .single();

    if (error || !booking) return res.status(404).json({ error: "No booking found for this QR code" });
    if (booking.parking_areas.owner_id !== req.userId) {
      return res.status(403).json({ error: "This booking isn't for one of your parking areas" });
    }
    if (booking.payment_status !== "paid") {
      return res.status(400).json({ error: "This booking hasn't been paid for" });
    }
    if (booking.status === "checked_in") {
      return res.status(400).json({ error: "Already checked in" });
    }
    if (booking.status !== "booked") {
      return res.status(400).json({ error: `Booking is ${booking.status}, can't check in` });
    }

    await supabaseAdmin
      .from("bookings")
      .update({ status: "checked_in", checked_in_at: new Date().toISOString(), entry_time: new Date().toISOString() })
      .eq("id", booking.id);

    res.json({
      success: true,
      message: `Checked in for ${booking.parking_areas.name}`,
      bookingId: booking.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Check-in failed" });
  }
});

// ------------------------------------------------------------------
// POST /api/checkin/scan-exit
// Auth: owner's Supabase session token
// Body: { qrToken }
// Owner scans the same QR on the way out. Marks the booking complete,
// records exit_time, and calculates any overtime (rider stayed past their
// booked slot_end). Overtime is NOT auto-charged (no saved payment method
// in this flow) - it's shown to the owner to collect in person, and logged
// on the booking for the record.
// ------------------------------------------------------------------
router.post("/scan-exit", requireAuth, async (req, res) => {
  try {
    const { qrToken } = req.body;
    if (!qrToken) return res.status(400).json({ error: "qrToken is required" });

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("*, parking_areas(id, name, owner_id, price_per_hour)")
      .eq("qr_token", qrToken)
      .single();

    if (error || !booking) return res.status(404).json({ error: "No booking found for this QR code" });
    if (booking.parking_areas.owner_id !== req.userId) {
      return res.status(403).json({ error: "This booking isn't for one of your parking areas" });
    }
    if (booking.status !== "checked_in") {
      return res.status(400).json({ error: `Booking is ${booking.status}, can't check out` });
    }

    const exitTime = new Date();
    const slotEnd = new Date(booking.slot_end);
    let overtimeAmount = 0;

    if (exitTime > slotEnd) {
      const overtimeHours = (exitTime - slotEnd) / (1000 * 60 * 60);
      overtimeAmount = Math.round(overtimeHours * Number(booking.parking_areas.price_per_hour) * 100) / 100;
    }

    const finalAmount = Number(booking.amount) + overtimeAmount;

    await supabaseAdmin
      .from("bookings")
      .update({
        status: "completed",
        exit_time: exitTime.toISOString(),
        overtime_amount: overtimeAmount,
        final_amount: finalAmount,
      })
      .eq("id", booking.id);

    // Slot frees up again now that the rider has actually left
    const { data: slotConfig } = await supabaseAdmin
      .from("parking_slots")
      .select("available_slots, total_slots")
      .eq("parking_area_id", booking.parking_area_id)
      .eq("slot_type", booking.slot_type || "car")
      .single();

    if (slotConfig && slotConfig.available_slots < slotConfig.total_slots) {
      await supabaseAdmin
        .from("parking_slots")
        .update({ available_slots: slotConfig.available_slots + 1 })
        .eq("parking_area_id", booking.parking_area_id)
        .eq("slot_type", booking.slot_type || "car");
    }

    const { data: area } = await supabaseAdmin
      .from("parking_areas")
      .select("available_slots, total_slots")
      .eq("id", booking.parking_area_id)
      .single();
    if (area && area.available_slots < area.total_slots) {
      await supabaseAdmin
        .from("parking_areas")
        .update({ available_slots: area.available_slots + 1 })
        .eq("id", booking.parking_area_id);
    }

    res.json({
      success: true,
      message: "Checked out",
      overtimeAmount,
      finalAmount,
      overtimeNote:
        overtimeAmount > 0
          ? `Rider stayed past their slot - collect ₹${overtimeAmount} extra in person (not charged automatically).`
          : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Check-out failed" });
  }
});

module.exports = router;
