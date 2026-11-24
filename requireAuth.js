const supabaseAdmin = require("../supabaseAdmin");

// Expects: Authorization: Bearer <supabase access_token>
// Verifies the token against Supabase Auth (using the service-role client,
// which can validate any user's token) and attaches the real, authenticated
// user id to req.userId. This stops one owner from scanning/withdrawing
// against another owner's parking area just by guessing an id in the request
// body - the id used for permission checks always comes from the verified
// token, never from anything the client claims.
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Missing Authorization header" });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Invalid or expired session" });

  req.userId = data.user.id;
  next();
}

module.exports = requireAuth;
