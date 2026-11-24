const cron = require("node-cron");
const supabaseAdmin = require("../supabaseAdmin");

// Runs every minute. Calls the Postgres function auto_cancel_expired_bookings()
// defined in supabase/schema.sql, which expires any "booked" slot whose
// arrival_deadline has passed and frees up the spot again.
//
// This is a fallback for whenever pg_cron isn't enabled on your Supabase
// project. If you DID enable pg_cron (see schema.sql bottom comment), you
// can skip running this server-side job entirely - Postgres will do it itself.
function startAutoCancelJob() {
  cron.schedule("* * * * *", async () => {
    const { error } = await supabaseAdmin.rpc("auto_cancel_expired_bookings");
    if (error) {
      console.error("Auto-cancel job failed:", error.message);
    } else {
      console.log(`[${new Date().toISOString()}] Auto-cancel check ran`);
    }
  });
  console.log("⏱  Auto-cancel cron job scheduled (every minute)");
}

module.exports = startAutoCancelJob;
