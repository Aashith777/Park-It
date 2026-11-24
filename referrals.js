const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/referrals/apply
// Auth: verified session token
// Body: { code }
// Applies a referral code. Credits ₹50 to referrer and referee.
// ------------------------------------------------------------------
router.post("/apply", requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Referral code is required" });

    const formattedCode = code.trim().toUpperCase();

    // Check if referrer exists
    const { data: referrer, error: refErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, wallet_balance")
      .eq("referral_code", formattedCode)
      .single();

    if (refErr || !referrer) {
      return res.status(404).json({ error: "Invalid referral code" });
    }

    if (referrer.id === req.userId) {
      return res.status(400).json({ error: "You cannot use your own referral code" });
    }

    // Check if referee already has a referral record
    const { data: existing, error: checkErr } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("referee_id", req.userId)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (existing) {
      return res.status(400).json({ error: "You have already applied a referral code" });
    }

    // Load referee's profile
    const { data: referee, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance, full_name")
      .eq("id", req.userId)
      .single();

    if (profileErr || !referee) return res.status(404).json({ error: "Referee profile not found" });

    const REWARD = 50.00;

    // Insert referral record
    const { error: insErr } = await supabaseAdmin
      .from("referrals")
      .insert({
        referrer_id: referrer.id,
        referee_id: req.userId,
        status: "completed",
        reward_amount: REWARD,
      });

    if (insErr) throw insErr;

    // Credit referrer wallet
    await supabaseAdmin
      .from("profiles")
      .update({ wallet_balance: Number(referrer.wallet_balance) + REWARD })
      .eq("id", referrer.id);

    // Credit referee wallet
    await supabaseAdmin
      .from("profiles")
      .update({ wallet_balance: Number(referee.wallet_balance) + REWARD })
      .eq("id", req.userId);

    // Create notifications for referrer
    await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: referrer.id,
        title: "Referral Reward Credited!",
        message: `Your friend ${referee.full_name || "New User"} joined using your code. ₹${REWARD} has been credited to your wallet!`,
      });

    // Create notifications for referee
    await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: req.userId,
        title: "Referral Applied!",
        message: `Welcome to ParkIT! Referral applied successfully. ₹${REWARD} has been credited to your wallet!`,
      });

    res.json({
      success: true,
      message: `Referral applied! ₹${REWARD} has been credited to your wallet.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to apply referral code" });
  }
});

// ------------------------------------------------------------------
// GET /api/referrals/stats
// Auth: verified session token
// Returns referrals statistics (list of people referred and code).
// ------------------------------------------------------------------
router.get("/stats", requireAuth, async (req, res) => {
  try {
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("referral_code, wallet_balance")
      .eq("id", req.userId)
      .single();

    if (pErr || !profile) return res.status(404).json({ error: "Profile not found" });

    const { data: referredList, error: listErr } = await supabaseAdmin
      .from("referrals")
      .select("created_at, referee:profiles!referrals_referee_id_fkey(full_name)")
      .eq("referrer_id", req.userId);

    if (listErr) throw listErr;

    res.json({
      referralCode: profile.referral_code,
      walletBalance: profile.wallet_balance,
      referralsCount: referredList?.length ?? 0,
      referredFriends: (referredList || []).map((r) => ({
        date: r.created_at,
        name: r.referee?.full_name || "Referral User",
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load referral stats" });
  }
});

module.exports = router;
