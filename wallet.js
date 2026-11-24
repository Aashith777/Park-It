const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// GET /api/wallet/me
// Auth: owner's Supabase session token
// Returns the owner's current wallet balance and recent transactions.
// ------------------------------------------------------------------
router.get("/me", requireAuth, async (req, res) => {
  const { data: wallet } = await supabaseAdmin
    .from("owner_wallets")
    .select("balance")
    .eq("owner_id", req.userId)
    .single();

  const { data: transactions } = await supabaseAdmin
    .from("wallet_transactions")
    .select("*")
    .eq("owner_id", req.userId)
    .order("created_at", { ascending: false })
    .limit(20);

  res.json({
    balance: wallet?.balance ?? 0,
    transactions: transactions ?? [],
  });
});

// ------------------------------------------------------------------
// POST /api/wallet/withdraw
// Auth: owner's Supabase session token
// Body: { amount }
// Requests a withdrawal. This reserves the funds immediately (moves them
// out of the withdrawable balance) and creates a "requested" payout record.
//
// IMPORTANT - what this does NOT do yet: actually move money to the
// owner's bank account. That requires Razorpay's Payouts product
// (RazorpayX), which - like Route - needs approval from Razorpay for your
// business account. Until you set that up, treat the `payouts` table as a
// queue you settle manually (bank transfer, UPI, etc.) and then mark
// processed yourself in Supabase. To automate it later, add a call here to
// razorpay.payouts.create(...) using RazorpayX, and update the payout's
// status based on the response.
// ------------------------------------------------------------------
router.post("/withdraw", requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

    const { data: payoutId, error } = await supabaseAdmin.rpc("request_payout", {
      p_owner: req.userId,
      p_amount: amount,
    });

    if (error) return res.status(400).json({ error: error.message });

    res.json({
      success: true,
      payoutId,
      message: "Withdrawal requested. It'll be settled to your bank shortly.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Withdrawal request failed" });
  }
});

module.exports = router;
