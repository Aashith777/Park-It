const cron = require("node-cron");
const supabaseAdmin = require("../supabaseAdmin");

function startReminderJob() {
  // Runs every minute
  cron.schedule("*/1 * * * *", async () => {
    try {
      const now = new Date();

      // 1. Check for bookings ending in exactly 15 minutes (or between 14 and 16 mins)
      const fifteenMinsLater = new Date(now.getTime() + 15 * 60 * 1000);
      const startWindow = new Date(fifteenMinsLater.getTime() - 45 * 1000); // -45s
      const endWindow = new Date(fifteenMinsLater.getTime() + 45 * 1000);   // +45s

      const { data: bookings15, error: err15 } = await supabaseAdmin
        .from("bookings")
        .select("*, parking_areas(name), profiles(full_name)")
        .eq("status", "booked")
        .eq("payment_status", "paid")
        .gte("slot_end", startWindow.toISOString())
        .lte("slot_end", endWindow.toISOString());

      if (!err15 && bookings15 && bookings15.length > 0) {
        for (const booking of bookings15) {
          // Check if notification already exists to avoid duplicate sends
          const notificationTitle = "⏱️ 15 minutes remaining!";
          const { data: existing } = await supabaseAdmin
            .from("notifications")
            .select("id")
            .eq("user_id", booking.user_id)
            .eq("title", notificationTitle)
            .ilike("message", `%${booking.id.substring(0, 8)}%`)
            .maybeSingle();

          if (!existing) {
            await supabaseAdmin.from("notifications").insert({
              user_id: booking.user_id,
              title: notificationTitle,
              message: `Your booking (ID: ${booking.id.substring(0, 8)}) at ${booking.parking_areas.name} ends in 15 minutes. Please head to the gate.`,
            });
            console.log(`[Reminder Job] Sent 15 mins reminder for booking ${booking.id}`);
          }
        }
      }

      // 2. Check for checked-in bookings that have exceeded slot_end (Exit reminders)
      // Run every minute, but only alert once every 10 minutes or check if we already alerted in the last 10 mins.
      // For simplicity, we search for checked_in bookings where slot_end < now.
      const { data: bookingsOverdue, error: errOverdue } = await supabaseAdmin
        .from("bookings")
        .select("*, parking_areas(name, price_per_hour)")
        .eq("status", "checked_in")
        .lt("slot_end", now.toISOString());

      if (!errOverdue && bookingsOverdue && bookingsOverdue.length > 0) {
        for (const booking of bookingsOverdue) {
          // Send an exit reminder every 10 minutes.
          // Check when the last exit reminder notification was created.
          const notificationTitle = "⚠️ Overdue Exit Reminder";
          const { data: lastAlert } = await supabaseAdmin
            .from("notifications")
            .select("created_at")
            .eq("user_id", booking.user_id)
            .eq("title", notificationTitle)
            .ilike("message", `%${booking.id.substring(0, 8)}%`)
            .order("created_at", { ascending: false })
            .limit(1);

          let shouldAlert = true;
          if (lastAlert && lastAlert.length > 0) {
            const lastAlertTime = new Date(lastAlert[0].created_at);
            const timeDiffMins = (now - lastAlertTime) / (1000 * 60);
            if (timeDiffMins < 10) {
              shouldAlert = false; // Only alert every 10 minutes
            }
          }

          if (shouldAlert) {
            await supabaseAdmin.from("notifications").insert({
              user_id: booking.user_id,
              title: notificationTitle,
              message: `Your booking (ID: ${booking.id.substring(0, 8)}) at ${booking.parking_areas.name} ended. You are currently in overtime. Rate: ₹${booking.parking_areas.price_per_hour}/hr. Please exit soon.`,
            });
            console.log(`[Reminder Job] Sent overdue exit reminder for booking ${booking.id}`);
          }
        }
      }
    } catch (err) {
      console.error("[Reminder Job] Error running reminder cron:", err);
    }
  });

  console.log("⏱️ Booking reminder notifications cron job started.");
}

module.exports = startReminderJob;
