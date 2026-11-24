const express = require("express");
const supabaseAdmin = require("../supabaseAdmin");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// GET /api/notifications/me
// Auth: verified session token
// Returns unread and recent notifications for the logged in user.
// ------------------------------------------------------------------
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { data: notifications, error } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    res.json(notifications || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// ------------------------------------------------------------------
// POST /api/notifications/:id/read
// Auth: verified session token
// Marks a single notification as read.
// ------------------------------------------------------------------
router.post("/:id/read", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", req.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

// ------------------------------------------------------------------
// POST /api/notifications/read-all
// Auth: verified session token
// Marks all notifications of this user as read.
// ------------------------------------------------------------------
router.post("/read-all", requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", req.userId);

    if (error) throw error;
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

module.exports = router;
