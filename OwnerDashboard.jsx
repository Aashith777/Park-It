import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

export default function OwnerDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState([]);
  const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
  const [todayBookings, setTodayBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState("");
  
  // Safety SOS Alerts state
  const [sosAlerts, setSosAlerts] = useState([]);

  // Analytics states
  const [analytics, setAnalytics] = useState({
    dailyRevenue: [],
    peakHours: [],
    vehicleDistribution: [],
  });

  const fetchWallet = async () => {
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/wallet/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) setWallet(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSosAlerts = async () => {
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/sos/my-incidents`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // filter active incidents
        setSosAlerts(data.filter((i) => i.status === "active"));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const resolveSos = async (id) => {
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/sos/${id}/resolve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        fetchSosAlerts();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const computeAnalytics = async () => {
    try {
      // Fetch all bookings for owner's parking lots
      const { data: myAreas } = await supabase
        .from("parking_areas")
        .select("id")
        .eq("owner_id", session.user.id);

      const areaIds = (myAreas || []).map((a) => a.id);
      if (areaIds.length === 0) return;

      const { data: bookings } = await supabase
        .from("bookings")
        .select("amount, created_at, slot_start, slot_type")
        .eq("payment_status", "paid")
        .in("parking_area_id", areaIds);

      const list = bookings || [];

      // 1. Daily Revenue (last 7 days)
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dailyMap = {};
      
      // Initialize last 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayStr = dayNames[d.getDay()];
        dailyMap[dayStr] = 0;
      }

      list.forEach((b) => {
        const date = new Date(b.created_at);
        const dayStr = dayNames[date.getDay()];
        if (dailyMap[dayStr] !== undefined) {
          dailyMap[dayStr] += Number(b.amount || 0);
        }
      });

      const dailyRevenue = Object.keys(dailyMap).map((day) => ({
        label: day,
        value: Math.round(dailyMap[day]),
      }));

      // 2. Peak Hours Occupancy
      // Count slots started in different hours: Night (10PM-6AM), Morning (6AM-5PM), Evening (5PM-10PM)
      let morningCount = 0;
      let eveningCount = 0;
      let nightCount = 0;

      list.forEach((b) => {
        const hour = new Date(b.slot_start).getHours();
        if (hour >= 6 && hour < 17) morningCount++;
        else if (hour >= 17 && hour < 22) eveningCount++;
        else nightCount++;
      });

      const peakHours = [
        { label: "Morning", value: morningCount },
        { label: "Evening Peak", value: eveningCount },
        { label: "Night", value: nightCount },
      ];

      // 3. Vehicle Type Distribution
      const vehicleMap = { bike: 0, car: 0, suv: 0, ev: 0, truck: 0 };
      list.forEach((b) => {
        const type = b.slot_type || "car";
        if (vehicleMap[type] !== undefined) {
          vehicleMap[type]++;
        }
      });

      const vehicleDistribution = Object.keys(vehicleMap).map((type) => ({
        label: type.toUpperCase(),
        value: vehicleMap[type],
      }));

      setAnalytics({ dailyRevenue, peakHours, vehicleDistribution });
    } catch (err) {
      console.error("Analytics computation error", err);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: statsData, error }, { data: todayData }] = await Promise.all([
      supabase.rpc("owner_dashboard_stats", { owner: session.user.id }),
      supabase.rpc("owner_today_bookings", { owner: session.user.id }),
    ]);
    if (!error) setStats(statsData || []);
    
    // Fetch customer details (phone) so owner can click to call
    // Query rider profile fields associated with today's bookings
    const modifiedTodayData = todayData || [];
    if (modifiedTodayData.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, phone");
      
      const phoneMap = (profiles || []).reduce((acc, p) => ({ ...acc, [p.id]: p.phone }), {});
      
      // Let's load the bookings table directly to resolve user_id mapping
      const { data: bList } = await supabase
        .from("bookings")
        .select("id, user_id")
        .in("id", modifiedTodayData.map(b => b.booking_id));

      const bookingUserMap = (bList || []).reduce((acc, b) => ({ ...acc, [b.id]: b.user_id }), {});
      
      modifiedTodayData.forEach(b => {
        const userId = bookingUserMap[b.booking_id];
        b.phone = phoneMap[userId] || "";
      });
    }

    setTodayBookings(modifiedTodayData);
    await fetchWallet();
    await fetchSosAlerts();
    await computeAnalytics();
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel("owner-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, fetchAll)
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawMsg("");
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/wallet/withdraw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount: Number(withdrawAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Withdrawal failed");
      setWithdrawMsg(data.message);
      setWithdrawAmount("");
      fetchWallet();
    } catch (err) {
      setWithdrawMsg(err.message);
    }
    setWithdrawing(false);
  };

  const grossRevenue = stats.reduce((sum, s) => sum + Number(s.gross_revenue), 0);
  const platformFee = stats.reduce((sum, s) => sum + Number(s.platform_fee), 0);
  const netPayout = stats.reduce((sum, s) => sum + Number(s.net_payout), 0);
  const totalBookings = stats.reduce((sum, s) => sum + Number(s.total_bookings), 0);
  const activeNow = stats.reduce((sum, s) => sum + Number(s.active_bookings), 0);

  if (loading) return <p className="max-w-5xl mx-auto px-5 py-10 text-asphalt/60">Loading Dashboard Metrics…</p>;

  // Find max daily revenue for chart scaling
  const maxRev = Math.max(...analytics.dailyRevenue.map((d) => d.value), 100);

  return (
    <div className="max-w-5xl mx-auto px-5 py-10">
      
      {/* SOS Alert Banner */}
      {sosAlerts.length > 0 && (
        <div className="bg-red-50 border-2 border-red-500 rounded-3xl p-5 mb-8 shadow-md animate-pulse">
          <div className="flex items-center gap-3 mb-2 text-red-700 font-bold">
            <span className="text-2xl">🚨</span>
            <h2 className="text-base font-display">SOS ACTIVE EMERGENCY REPORTED</h2>
          </div>
          <div className="space-y-3">
            {sosAlerts.map((sos) => (
              <div key={sos.id} className="bg-white border border-red-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-red-600 font-bold uppercase">LOT: {sos.parking_areas?.name}</p>
                  <p className="font-semibold text-sm text-ink mt-0.5">Rider: {sos.profiles?.full_name} · {sos.profiles?.phone || "No phone"}</p>
                  <p className="text-xs text-asphalt mt-1">Incident: <span className="font-bold text-red-600 uppercase">{sos.type.replace(/_/g, " ")}</span></p>
                  <p className="text-xs text-asphalt/70 mt-0.5">"{sos.details || "No comments"}"</p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`tel:${sos.profiles?.phone}`}
                    className="bg-red-600 text-white font-bold text-xs rounded-full px-4 py-2 hover:bg-red-700 transition"
                  >
                    📞 Call Rider
                  </a>
                  <button
                    onClick={() => resolveSos(sos.id)}
                    className="bg-emerald-600 text-white font-bold text-xs rounded-full px-4 py-2 hover:bg-emerald-700 transition"
                  >
                    ✓ Mark Resolved
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Owner Dashboard</h1>
          <p className="text-xs text-asphalt/60">Configure capacities, review analytics charts, and request payouts.</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/owner/scan"
            className="border border-ink/15 px-5 py-2.5 rounded-full text-sm font-medium hover:bg-mist transition bg-white"
          >
            Scan QR Check-In/Exit
          </Link>
          <Link
            to="/owner/add-parking"
            className="bg-signal text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-signal/90 transition shadow-sm"
          >
            + Add Parking Area
          </Link>
        </div>
      </div>

      {/* Wallet */}
      <div className="bg-ink text-white rounded-3xl p-6 mb-8 flex flex-wrap items-center justify-between gap-6 shadow-lg">
        <div>
          <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Withdrawable Balance</p>
          <p className="font-display text-4xl font-bold">₹{Number(wallet.balance).toFixed(2)}</p>
        </div>
        <div className="flex items-center gap-2 bg-white/10 p-3 rounded-2xl border border-white/5">
          <input
            type="number"
            min="1"
            max={wallet.balance}
            placeholder="Amount"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            className="w-24 rounded-lg px-3 py-2 text-ink text-sm border-0 focus:ring-0"
          />
          <button
            onClick={handleWithdraw}
            disabled={withdrawing || !withdrawAmount || Number(withdrawAmount) > wallet.balance}
            className="bg-signal text-white px-5 py-2 rounded-full text-xs font-bold hover:bg-signal/90 disabled:opacity-40 transition active:scale-95"
          >
            {withdrawing ? "Requesting…" : "Withdraw"}
          </button>
        </div>
      </div>
      {withdrawMsg && <p className="text-xs text-asphalt/70 mb-6 -mt-4 bg-mist p-3 rounded-xl border border-black/5">{withdrawMsg}</p>}

      {/* Analytics Summary */}
      <div className="grid sm:grid-cols-3 gap-5 mb-6">
        <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
          <p className="text-asphalt/50 text-xs uppercase tracking-wider font-semibold">Gross Revenue</p>
          <h3 className="font-display text-2xl font-bold text-ink mt-1">₹{grossRevenue.toFixed(0)}</h3>
          <p className="text-[10px] text-asphalt/40 mt-1">Total rider fees collected</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
          <p className="text-asphalt/50 text-xs uppercase tracking-wider font-semibold">Commission (15%)</p>
          <h3 className="font-display text-2xl font-bold text-asphalt/40 mt-1">− ₹{platformFee.toFixed(0)}</h3>
          <p className="text-[10px] text-asphalt/40 mt-1">Platform management fee</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border-2 border-signal/20 bg-signal/5 shadow-sm">
          <p className="text-asphalt/50 text-xs uppercase tracking-wider font-semibold">Net earnings share</p>
          <h3 className="font-display text-2xl font-bold text-signal mt-1">₹{netPayout.toFixed(0)}</h3>
          <p className="text-[10px] text-signal/60 mt-1">Credited straight to wallet</p>
        </div>
      </div>

      {/* Bookings Stats */}
      <div className="grid grid-cols-2 gap-5 mb-10">
        <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
          <p className="text-asphalt/50 text-xs uppercase tracking-wider font-semibold">Total Paid Bookings</p>
          <h3 className="font-display text-xl font-bold text-ink mt-1">{totalBookings}</h3>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
          <p className="text-asphalt/50 text-xs uppercase tracking-wider font-semibold">Active Right Now</p>
          <h3 className="font-display text-xl font-bold text-go mt-1">{activeNow}</h3>
        </div>
      </div>

      {/* SVG Charts Analytics Visualization Section */}
      <div className="mb-10">
        <h2 className="font-display text-lg font-bold text-ink mb-4">Performance Analytics Charts</h2>
        <div className="grid md:grid-cols-3 gap-6">
          
          {/* Daily Revenue Bar Chart */}
          <div className="bg-white border border-black/5 rounded-3xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-xs text-asphalt uppercase tracking-wider mb-1">Daily Revenue</h4>
              <p className="text-[10px] text-asphalt/40 mb-4">Earnings trend over the last 7 days</p>
            </div>
            {analytics.dailyRevenue.length === 0 ? (
              <p className="text-xs text-asphalt/40 py-10 text-center">No bookings data found</p>
            ) : (
              <div className="flex items-end justify-between h-40 pt-4 px-2">
                {analytics.dailyRevenue.map((d, i) => {
                  const percent = Math.max(5, (d.value / maxRev) * 100);
                  return (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1 group">
                      <span className="text-[9px] font-bold text-signal opacity-0 group-hover:opacity-100 transition-opacity">₹{d.value}</span>
                      <div
                        style={{ height: `${percent}%` }}
                        className="w-5 bg-signal/15 group-hover:bg-signal border-t-2 border-signal rounded-t-md transition-all duration-300"
                      />
                      <span className="text-[10px] font-semibold text-asphalt/60">{d.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Peak Hours Occupancy Line Chart */}
          <div className="bg-white border border-black/5 rounded-3xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-xs text-asphalt uppercase tracking-wider mb-1">Peak Booking Hours</h4>
              <p className="text-[10px] text-asphalt/40 mb-4">Distribution across day blocks</p>
            </div>
            {analytics.peakHours.length === 0 ? (
              <p className="text-xs text-asphalt/40 py-10 text-center">No scheduling records found</p>
            ) : (
              <div className="flex flex-col gap-4 py-4">
                {analytics.peakHours.map((h, i) => {
                  const total = analytics.peakHours.reduce((sum, item) => sum + item.value, 0) || 1;
                  const ratio = Math.round((h.value / total) * 100);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold">
                        <span className="text-ink">{h.label}</span>
                        <span className="text-signal">{h.value} slots ({ratio}%)</span>
                      </div>
                      <div className="w-full bg-mist h-2 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${ratio}%` }}
                          className="bg-signal h-full rounded-full transition-all duration-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vehicle Distribution */}
          <div className="bg-white border border-black/5 rounded-3xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-xs text-asphalt uppercase tracking-wider mb-1">Vehicle Slot Types</h4>
              <p className="text-[10px] text-asphalt/40 mb-4">Distribution by customer vehicle type</p>
            </div>
            {analytics.vehicleDistribution.length === 0 ? (
              <p className="text-xs text-asphalt/40 py-10 text-center">No vehicles recorded</p>
            ) : (
              <div className="space-y-3 py-3">
                {analytics.vehicleDistribution.map((v, i) => {
                  const total = analytics.vehicleDistribution.reduce((sum, item) => sum + item.value, 0) || 1;
                  const ratio = Math.round((v.value / total) * 100);
                  return (
                    <div key={i} className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-asphalt/70 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-ink" />
                        {v.label}
                      </span>
                      <span className="font-bold text-ink">{v.value} ({ratio}%)</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Today's Customers */}
      <h2 className="font-display text-lg font-bold text-ink mb-4">Today's Customers List</h2>
      {todayBookings.length === 0 ? (
        <div className="bg-white border border-black/5 rounded-2xl p-8 text-center text-asphalt/50 mb-10">
          No riders checked in or booked for today yet.
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-black/5 overflow-hidden shadow-sm mb-10">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse text-left">
              <thead className="bg-mist text-asphalt/60 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-5 py-3 font-medium">Rider Name</th>
                  <th className="px-5 py-3 font-medium">Lot Location</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Entry/Exit</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {todayBookings.map((b) => (
                  <tr key={b.booking_id} className="hover:bg-mist/30 transition">
                    <td className="px-5 py-3 font-semibold text-ink">{b.rider_name}</td>
                    <td className="px-5 py-3 text-asphalt/70 text-xs">{b.parking_area_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        b.status === 'checked_in' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {b.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-asphalt/60">
                      In: {b.entry_time ? new Date(b.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                      <br />
                      Out: {b.exit_time ? new Date(b.exit_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                    </td>
                    <td className="px-5 py-3 font-bold text-ink">₹{b.amount}</td>
                    <td className="px-5 py-3 text-right">
                      {b.phone && (
                        <div className="flex justify-end gap-1.5">
                          <a
                            href={`tel:${b.phone}`}
                            className="bg-white border border-ink/15 text-ink hover:bg-mist text-xs font-semibold px-3 py-1.5 rounded-full transition active:scale-95"
                          >
                            📞 Call
                          </a>
                          <a
                            href={`https://wa.me/${b.phone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-full transition active:scale-95"
                          >
                            💬 Message
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent wallet transactions */}
      <h2 className="font-display text-lg font-bold text-ink mb-4">Recent Wallet Activity</h2>
      {wallet.transactions.length === 0 ? (
        <div className="bg-white border border-black/5 rounded-2xl p-6 text-center text-asphalt/50 mb-10">No recent transactions logged.</div>
      ) : (
        <div className="bg-white rounded-3xl border border-black/5 overflow-hidden shadow-sm mb-10">
          <table className="w-full text-sm border-collapse text-left">
            <tbody className="divide-y divide-black/5">
              {wallet.transactions.map((t) => (
                <tr key={t.id} className="hover:bg-mist/30 transition">
                  <td className="px-5 py-4 text-xs text-asphalt/50">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-5 py-4 text-ink font-medium">{t.description}</td>
                  <td className={`px-5 py-4 text-right font-bold ${t.type === "credit" ? "text-green-600" : "text-asphalt/60"}`}>
                    {t.type === "credit" ? "+" : "−"} ₹{Number(t.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* By parking area breakdown */}
      <h2 className="font-display text-lg font-bold text-ink mb-4 font-display">Performance by Parking Lot</h2>
      {stats.length === 0 ? (
        <p className="text-asphalt/50 text-sm">No listed lots active.</p>
      ) : (
        <div className="bg-white rounded-3xl border border-black/5 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse text-left">
              <thead className="bg-mist text-asphalt/60 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-5 py-3 font-medium">Lot Name</th>
                  <th className="px-5 py-3 font-medium">Total Bookings</th>
                  <th className="px-5 py-3 font-medium">Active Bookings</th>
                  <th className="px-5 py-3 font-medium">Gross Rev</th>
                  <th className="px-5 py-3 font-medium">Platform Fee</th>
                  <th className="px-5 py-3 font-medium">Withdrawn Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {stats.map((s) => (
                  <tr key={s.parking_area_id} className="hover:bg-mist/30 transition">
                    <td className="px-5 py-4 font-semibold text-ink">{s.parking_area_name}</td>
                    <td className="px-5 py-4 text-asphalt/70">{s.total_bookings}</td>
                    <td className="px-5 py-4 text-go font-bold">{s.active_bookings}</td>
                    <td className="px-5 py-4 font-medium text-ink">₹{Number(s.gross_revenue).toFixed(2)}</td>
                    <td className="px-5 py-4 text-asphalt/50">− ₹{Number(s.platform_fee).toFixed(2)}</td>
                    <td className="px-5 py-4 font-bold text-signal">₹{Number(s.net_payout).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
