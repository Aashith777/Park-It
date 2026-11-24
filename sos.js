const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/sos/report
// Auth: verified session token (rider)
// Body: { bookingId, type, details }
// Creates a high-priority incident alert and notifies the owner and admin.
// ------------------------------------------------------------------
router.post("/report", requireAuth, async (req, res) => {
  try {
    const { bookingId, type, details } = req.body;
    if (!bookingId || !type) {
      return res.status(400).json({ error: "bookingId and type are required" });
    }

    // Look up the booking
    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select("*, parking_areas(id, name, owner_id), profiles(full_name, phone)")
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.user_id !== req.userId) {
      return res.status(403).json({ error: "This booking does not belong to you" });
    }

    const parkingAreaId = booking.parking_areas.id;
    const ownerId = booking.parking_areas.owner_id;
    const riderName = booking.profiles.full_name || "Rider";
    const parkingName = booking.parking_areas.name;

    // Create the incident
    const { data: incident, error: insErr } = await supabaseAdmin
      .from("incidents")
      .insert({
        booking_id: bookingId,
        user_id: req.userId,
        parking_area_id: parkingAreaId,
        type,
        details: details || `Emergency SOS reported by ${riderName}`,
        status: "active",
      })
      .select()
      .single();

    if (insErr) throw insErr;

    // Create notification for the owner
    await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: ownerId,
        title: "🚨 SOS EMERGENCY ALERT!",
        message: `Rider ${riderName} reported a "${type.replace(/_/g, " ")}" emergency at your lot "${parkingName}". Details: ${details || "No comments"}. Contact immediately!`,
      });

    // Create notification for all admins
    const { data: admins } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("role", "admin");

    if (admins && admins.length > 0) {
      const adminNotifications = admins.map((admin) => ({
        user_id: admin.id,
        title: "🚨 PLATFORM SOS ALERT",
        message: `Rider ${riderName} triggered SOS at "${parkingName}" (Owner ID: ${ownerId}). Incident: "${type.replace(/_/g, " ")}". Details: ${details || "None"}.`,
      }));
      await supabaseAdmin.from("notifications").insert(adminNotifications);
    }

    res.json({
      success: true,
      message: "SOS Report submitted successfully. Security and staff have been notified.",
      incident,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit SOS report" });
  }
});

// ------------------------------------------------------------------
// GET /api/sos/my-incidents
// Auth: verified session token
// Returns active incidents for the current user (rider or owner).
// ------------------------------------------------------------------
router.get("/my-incidents", requireAuth, async (req, res) => {
  try {
    // Determine user role
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", req.userId)
      .single();

    let query = supabaseAdmin.from("incidents").select("*, parking_areas(name, address), profiles(full_name, phone)");

    if (profile?.role === "owner") {
      // Find parking areas owned by this owner
      const { data: areas } = await supabaseAdmin
        .from("parking_areas")
        .select("id")
        .eq("owner_id", req.userId);

      const areaIds = (areas || []).map((a) => a.id);
      query = query.in("parking_area_id", areaIds);
    } else if (profile?.role === "admin") {
      // Admin sees everything
    } else {
      // Rider sees their own
      query = query.eq("user_id", req.userId);
    }

    const { data: incidents, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    res.json(incidents || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

// ------------------------------------------------------------------
// POST /api/sos/:id/resolve
// Resolves an incident (owner or admin only)
// ------------------------------------------------------------------
router.post("/:id/resolve", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check user role
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", req.userId)
      .single();

    if (profile?.role !== "owner" && profile?.role !== "admin") {
      return res.status(403).json({ error: "Only parking owners or admins can resolve incidents" });
    }

    const { error } = await supabaseAdmin
      .from("incidents")
      .update({ status: "resolved" })
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true, message: "Incident marked as resolved." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to resolve incident" });
  }
});

module.exports = router;
