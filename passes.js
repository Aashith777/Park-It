const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// GET /api/passes/active
// Auth: verified session token
// Returns active monthly passes for this user.
// ------------------------------------------------------------------
router.get("/active", requireAuth, async (req, res) => {
  try {
    const { data: passes, error } = await supabaseAdmin
      .from("monthly_passes")
      .select("*, parking_areas(id, name, address, city)")
      .eq("user_id", req.userId)
      .eq("status", "active")
      .gt("end_date", new Date().toISOString());

    if (error) throw error;
    res.json(passes || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load active passes" });
  }
});

// ------------------------------------------------------------------
// POST /api/passes/buy
// Auth: verified session token
// Body: { parkingAreaId, months }
// Purchases a monthly parking pass using the user's rider wallet balance.
// ------------------------------------------------------------------
router.post("/buy", requireAuth, async (req, res) => {
  try {
    const { parkingAreaId, months = 1 } = req.body;
    if (!parkingAreaId) return res.status(400).json({ error: "parkingAreaId is required" });

    const pricePerMonth = 2000.00;
    const pricePaid = pricePerMonth * months;

    // Load rider's profile to check balance
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", req.userId)
      .single();

    if (pErr || !profile) return res.status(404).json({ error: "Profile not found" });

    if (Number(profile.wallet_balance) < pricePaid) {
      return res.status(400).json({
        error: `Insufficient wallet balance. Pass cost is ₹${pricePaid}, but you only have ₹${profile.wallet_balance}. Please top up.`,
      });
    }

    // Deduct balance
    const newBalance = Number(profile.wallet_balance) - pricePaid;
    const { error: deductErr } = await supabaseAdmin
      .from("profiles")
      .update({ wallet_balance: newBalance })
      .eq("id", req.userId);

    if (deductErr) throw deductErr;

    // Calculate dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (30 * months));

    // Create the pass
    const { data: pass, error: insErr } = await supabaseAdmin
      .from("monthly_passes")
      .insert({
        user_id: req.userId,
        parking_area_id: parkingAreaId,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        price_paid: pricePaid,
        status: "active",
      })
      .select()
      .single();

    if (insErr) {
      // Rollback balance deduction
      await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: profile.wallet_balance })
        .eq("id", req.userId);
      throw insErr;
    }

    res.json({
      success: true,
      message: `Monthly Parking Pass purchased successfully! Valid until ${endDate.toLocaleDateString()}.`,
      pass,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to purchase monthly pass" });
  }
});

module.exports = router;
