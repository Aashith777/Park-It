const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// Helper to check if caller is admin
async function requireAdmin(req, res, next) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", req.userId)
    .single();

  if (error || profile?.role !== "admin") {
    return res.status(403).json({ error: "Access denied. Admin role required." });
  }
  next();
}

// ------------------------------------------------------------------
// GET /api/admin/stats
// Auth: verified session token + admin role
// Returns system-wide statistics for the dashboard.
// ------------------------------------------------------------------
router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    // 1. Total Riders
    const { count: totalRiders } = await supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "rider");

    // 2. Total Owners
    const { count: totalOwners } = await supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "owner");

    // 3. Bookings and Revenue
    const { data: bookingsData } = await supabaseAdmin
      .from("bookings")
      .select("amount, platform_fee_amount, owner_payout_amount, payment_status, status");

    const totalBookings = bookingsData?.length ?? 0;
    const paidBookings = bookingsData?.filter((b) => b.payment_status === "paid") ?? [];
    
    const grossRevenue = paidBookings.reduce((sum, b) => sum + Number(b.amount || 0), 0);
    const platformCommission = paidBookings.reduce((sum, b) => sum + Number(b.platform_fee_amount || 0), 0);
    const netOwnerPayouts = paidBookings.reduce((sum, b) => sum + Number(b.owner_payout_amount || 0), 0);

    // 4. Cities count
    const { data: parkingAreas } = await supabaseAdmin
      .from("parking_areas")
      .select("city");
    
    const uniqueCities = [...new Set((parkingAreas || []).map((p) => p.city?.toLowerCase()))].filter(Boolean);
    const citiesCount = uniqueCities.length;

    // 5. Payouts processed
    const { data: payoutsData } = await supabaseAdmin
      .from("payouts")
      .select("amount, status");
    
    const paidPayoutsSum = (payoutsData || [])
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const pendingPayoutsSum = (payoutsData || [])
      .filter((p) => p.status === "requested" || p.status === "processing")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // 6. Load pending owners
    const { data: pendingOwners } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, created_at")
      .eq("role", "owner")
      .eq("is_approved", false);

    // 7. Load pending parking areas
    const { data: pendingParkings } = await supabaseAdmin
      .from("parking_areas")
      .select("id, name, address, city, price_per_hour, total_slots, profiles(full_name)")
      .eq("is_approved", false);

    // 8. Load pending payouts
    const { data: pendingPayouts } = await supabaseAdmin
      .from("payouts")
      .select("id, amount, requested_at, status, profiles(full_name, phone, razorpay_account_id)")
      .in("status", ["requested", "processing"])
      .order("requested_at", { ascending: true });

    res.json({
      metrics: {
        totalRiders: totalRiders ?? 0,
        totalOwners: totalOwners ?? 0,
        totalBookings,
        grossRevenue,
        platformCommission,
        netOwnerPayouts,
        citiesCount,
        paidPayoutsSum,
        pendingPayoutsSum,
      },
      pendingOwners: pendingOwners || [],
      pendingParkings: pendingParkings || [],
      pendingPayouts: pendingPayouts || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
});

// ------------------------------------------------------------------
// POST /api/admin/approve-owner
// Auth: verified session token + admin role
// Body: { ownerId, approve }
// Approves or rejects an owner profile registration.
// ------------------------------------------------------------------
router.post("/approve-owner", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ownerId, approve } = req.body;
    if (!ownerId) return res.status(400).json({ error: "ownerId is required" });

    const status = !!approve;

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_approved: status })
      .eq("id", ownerId);

    if (error) throw error;

    // Send notifications to the owner
    await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: ownerId,
        title: status ? "Congratulations! Account Approved 🎉" : "Account Suspended",
        message: status 
          ? "Your owner profile has been approved by the admin. You can now list parking areas and start earning."
          : "Your owner profile has been suspended/rejected by the admin.",
      });

    res.json({ success: true, message: `Owner ${status ? 'approved' : 'rejected'}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve owner" });
  }
});

// ------------------------------------------------------------------
// POST /api/admin/approve-parking
// Auth: verified session token + admin role
// Body: { parkingId, approve }
// Approves or rejects a parking area listing.
// ------------------------------------------------------------------
router.post("/approve-parking", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { parkingId, approve } = req.body;
    if (!parkingId) return res.status(400).json({ error: "parkingId is required" });

    const status = !!approve;

    // Fetch the parking to notify owner
    const { data: parking } = await supabaseAdmin
      .from("parking_areas")
      .select("owner_id, name")
      .eq("id", parkingId)
      .single();

    const { error } = await supabaseAdmin
      .from("parking_areas")
      .update({ is_approved: status })
      .eq("id", parkingId);

    if (error) throw error;

    if (parking) {
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: parking.owner_id,
          title: status ? "Parking Listing Approved! 🅿️" : "Parking Listing Rejected",
          message: status 
            ? `Your parking area "${parking.name}" has been approved and is now public for booking.`
            : `Your parking area "${parking.name}" has been rejected or suspended by the admin.`,
        });
    }

    res.json({ success: true, message: `Parking area ${status ? 'approved' : 'rejected'}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve parking area" });
  }
});

// ------------------------------------------------------------------
// POST /api/admin/approve-payout
// Auth: verified session token + admin role
// Body: { payoutId, status } (status can be 'paid' or 'failed')
// Settles or rejects a withdrawal request.
// ------------------------------------------------------------------
router.post("/approve-payout", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { payoutId, status } = req.body;
    if (!payoutId || !["paid", "failed"].includes(status)) {
      return res.status(400).json({ error: "payoutId and valid status ('paid' or 'failed') are required" });
    }

    // Fetch payout details to credit back balance if failed
    const { data: payout } = await supabaseAdmin
      .from("payouts")
      .select("*")
      .eq("id", payoutId)
      .single();

    if (!payout) return res.status(404).json({ error: "Payout request not found" });
    if (payout.status === "paid") return res.status(400).json({ error: "Payout already processed as paid" });

    // Update payout status
    const { error } = await supabaseAdmin
      .from("payouts")
      .update({ 
        status, 
        processed_at: new Date().toISOString() 
      })
      .eq("id", payoutId);

    if (error) throw error;

    if (status === "failed") {
      // Revert wallet balance!
      const { data: wallet } = await supabaseAdmin
        .from("owner_wallets")
        .select("balance")
        .eq("owner_id", payout.owner_id)
        .single();
      
      const currentBalance = Number(wallet?.balance ?? 0);
      await supabaseAdmin
        .from("owner_wallets")
        .update({ balance: currentBalance + Number(payout.amount), updated_at: new Date().toISOString() })
        .eq("owner_id", payout.owner_id);

      // Log wallet transaction credit back
      await supabaseAdmin
        .from("wallet_transactions")
        .insert({
          owner_id: payout.owner_id,
          type: "credit",
          amount: payout.amount,
          description: "Withdrawal failed - balance credited back",
        });

      // Send notification
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: payout.owner_id,
          title: "❌ Payout Request Failed",
          message: `Your withdrawal request for ₹${payout.amount} has failed or was rejected. The funds have been refunded to your wallet.`,
        });
    } else {
      // Send notification
      await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: payout.owner_id,
          title: "💵 Withdrawal Settled Success",
          message: `Your withdrawal of ₹${payout.amount} has been successfully settled to your bank account!`,
        });
    }

    res.json({ success: true, message: `Payout status updated to: ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process payout" });
  }
});

module.exports = router;
