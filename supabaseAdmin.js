const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// Service-role client: full DB access, bypasses Row Level Security.
// Used only here on the server for trusted operations (confirming payment, auto-cancel).
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabaseAdmin;
