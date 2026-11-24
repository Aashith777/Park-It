const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// GET /api/favorites/me
// Auth: verified session token
// Returns list of user's favorited parking areas.
// ------------------------------------------------------------------
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("favorites")
      .select("parking_area_id, parking_areas(*)")
      .eq("user_id", req.userId);

    if (error) throw error;
    res.json(data.map((fav) => fav.parking_areas).filter(Boolean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load favorites" });
  }
});

// ------------------------------------------------------------------
// POST /api/favorites/toggle
// Auth: verified session token
// Body: { parkingAreaId }
// Toggles the favorite status for a given parking area.
// ------------------------------------------------------------------
router.post("/toggle", requireAuth, async (req, res) => {
  try {
    const { parkingAreaId } = req.body;
    if (!parkingAreaId) return res.status(400).json({ error: "parkingAreaId is required" });

    // Check if favorite exists
    const { data: existing, error: checkErr } = await supabaseAdmin
      .from("favorites")
      .select("id")
      .eq("user_id", req.userId)
      .eq("parking_area_id", parkingAreaId)
      .maybeSingle();

    if (checkErr) throw checkErr;

    if (existing) {
      // Delete favorite
      const { error: delErr } = await supabaseAdmin
        .from("favorites")
        .delete()
        .eq("id", existing.id);
      if (delErr) throw delErr;
      res.json({ favorited: false, message: "Removed from favorites" });
    } else {
      // Insert favorite
      const { error: insErr } = await supabaseAdmin
        .from("favorites")
        .insert({
          user_id: req.userId,
          parking_area_id: parkingAreaId,
        });
      if (insErr) throw insErr;
      res.json({ favorited: true, message: "Added to favorites" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle favorite status" });
  }
});

module.exports = router;
