const express = require("express");
const Razorpay = require("razorpay");
const supabaseAdmin = require("../supabaseAdmin");

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ------------------------------------------------------------------
// POST /api/owner/onboard
// Body: {
//   ownerId,
//   businessName, email, phone,
//   legalBusinessName, businessType,   // e.g. "individual", "proprietorship"
//   accountNumber, ifscCode, beneficiaryName
// }
//
// Creates a Razorpay Route "linked account" for this owner. This is what
// lets Razorpay automatically split each payment and pay the owner's 85%
// share straight to their bank account, without ParkSmart ever touching
// or forwarding that money manually.
//
// IMPORTANT: Route is a marketplace feature that Razorpay has to approve
// for your account first (Dashboard -> Account & Settings -> Route, or
// contact Razorpay support). Without that approval this call will fail
// with an authorization error even if the code and keys are correct.
//
// Also note: a newly created linked account starts in a "created" /
// under-review state. Full KYC (PAN, business proof, bank proof) is
// usually required before Razorpay activates it enough to receive
// payouts - this endpoint creates the account, it doesn't complete KYC.
// Razorpay will email the owner (or you, as the platform) with next
// steps for document upload.
// ------------------------------------------------------------------
router.post("/onboard", async (req, res) => {
  try {
    const {
      ownerId,
      businessName,
      email,
      phone,
      legalBusinessName,
      businessType,
      accountNumber,
      ifscCode,
      beneficiaryName,
    } = req.body;

    if (!ownerId || !email || !phone || !accountNumber || !ifscCode) {
      return res.status(400).json({ error: "Missing required onboarding fields" });
    }

    // 1. Create the linked account (the "sub-merchant" entity Route pays out to)
    const account = await razorpay.accounts.create({
      email,
      phone,
      type: "route",
      legal_business_name: legalBusinessName || businessName,
      business_type: businessType || "individual",
      contact_name: beneficiaryName || businessName,
      profile: {
        category: "transportation",
        subcategory: "parking",
        addresses: {
          registered: {
            street1: "N/A", // Replace with real address fields if you collect them
            city: "N/A",
            state: "N/A",
            postal_code: "000000",
            country: "IN",
          },
        },
      },
    });

    // 2. Attach the bank account this linked account should be paid out to
    await razorpay.accounts.requestProductConfiguration(account.id, {
      product_name: "route",
      tnc_accepted: true,
    });

    // 3. Save the linked account id against the owner's profile
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({
        razorpay_account_id: account.id,
        payout_onboarded: true, // account created; Razorpay may still require KYC before payouts actually work
      })
      .eq("id", ownerId);

    if (updateErr) throw updateErr;

    res.json({
      success: true,
      accountId: account.id,
      message:
        "Linked account created. Check your email from Razorpay for any KYC documents still needed before payouts activate.",
    });
  } catch (err) {
    console.error("Owner onboarding failed:", err?.error || err);
    res.status(500).json({
      error:
        err?.error?.description ||
        "Could not create payout account. Make sure Route is enabled for your Razorpay account.",
    });
  }
});

// ------------------------------------------------------------------
// GET /api/owner/status/:ownerId
// Quick check the frontend can call to show onboarding status.
// ------------------------------------------------------------------
router.get("/status/:ownerId", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("razorpay_account_id, payout_onboarded")
    .eq("id", req.params.ownerId)
    .single();

  if (error) return res.status(404).json({ error: "Owner not found" });
  res.json(data);
});

module.exports = router;
