require("dotenv").config();
const express = require("express");
const cors = require("cors");

const paymentRoutes = require("./routes/payment");
const ownerOnboardingRoutes = require("./routes/ownerOnboarding");
const checkinRoutes = require("./routes/checkin");
const walletRoutes = require("./routes/wallet");
const couponRoutes = require("./routes/coupons");
const favoriteRoutes = require("./routes/favorites");
const passRoutes = require("./routes/passes");
const referralRoutes = require("./routes/referrals");
const sosRoutes = require("./routes/sos");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const uploadRoutes = require("./routes/uploads");
const startAutoCancelJob = require("./jobs/autoCancel");
const startReminderJob = require("./jobs/reminderNotifications");

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://parkit-ashen.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/", (req, res) =>
  res.json({ status: "ParkSmart payment server running" })
);

app.use("/api/payment", paymentRoutes);
app.use("/api/owner", ownerOnboardingRoutes);
app.use("/api/checkin", checkinRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/passes", passRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/sos", sosRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/uploads", uploadRoutes);

// Serve uploads statically for parking images
const uploadsDir = require("path").join(__dirname, "uploads");
if (!require("fs").existsSync(uploadsDir)) {
  require("fs").mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 ParkSmart payment server running on port ${PORT}`);
  startAutoCancelJob();
  startReminderJob();
});