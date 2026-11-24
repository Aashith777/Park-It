const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/coupons/validate
// Auth: verified session token (rider or owner)
// Body: { code, bookingAmount }
// Validates coupon active status, expiry, min amount, and computes discount.
// ------------------------------------------------------------------
router.post("/validate", requireAuth, async (req, res) => {
  try {
    const { code, bookingAmount } = req.body;
    if (!code) return res.status(400).json({ error: "Coupon code is required" });
    if (!bookingAmount || bookingAmount <= 0) {
      return res.status(400).json({ error: "Invalid booking amount" });
    }

    const { data: coupon, error } = await supabaseAdmin
      .from("coupons")
      .select("*")
      .eq("code", code.trim().toUpperCase())
      .single();

    if (error || !coupon) {
      return res.status(404).json({ error: "Coupon code not found" });
    }

    if (!coupon.is_active) {
      return res.status(400).json({ error: "Coupon is inactive" });
    }

    if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
      return res.status(400).json({ error: "Coupon has expired" });
    }

    const minAmount = Number(coupon.min_booking_amount || 0);
    if (Number(bookingAmount) < minAmount) {
      return res.status(400).json({
        error: `Minimum booking amount of ₹${minAmount} required to use this coupon.`,
      });
    }

    let discountAmount = 0;
    if (coupon.discount_type === "flat") {
      discountAmount = Number(coupon.discount_value);
    } else if (coupon.discount_type === "percentage") {
      discountAmount = Math.round(Number(bookingAmount) * (Number(coupon.discount_value) / 100) * 100) / 100;
    }

    // Cap discount to bookingAmount
    if (discountAmount > Number(bookingAmount)) {
      discountAmount = Number(bookingAmount);
    }

    const finalAmount = Math.round((Number(bookingAmount) - discountAmount) * 100) / 100;

    res.json({
      success: true,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      discountAmount,
      finalAmount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to validate coupon" });
  }
});

// ------------------------------------------------------------------
// GET /api/coupons/active
// Returns all active coupons
// ------------------------------------------------------------------
router.get("/active", async (req, res) => {
  try {
    const { data: coupons, error } = await supabaseAdmin
      .from("coupons")
      .select("code, discount_type, discount_value, min_booking_amount")
      .eq("is_active", true);

    if (error) throw error;
    res.json(coupons || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load coupons" });
  }
});

module.exports = router;
