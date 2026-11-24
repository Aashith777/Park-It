import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

export default function AdminDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchStats = async () => {
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/admin/stats`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) throw new Error("Failed to load statistics");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchStats();
    }
  }, [session]);

  const handleApproveOwner = async (ownerId, approve) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/admin/approve-owner`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ownerId, approve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process owner approval");
      setSuccess(`Owner registration ${approve ? "approved" : "rejected"} successfully.`);
      fetchStats();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleApproveParking = async (parkingId, approve) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/admin/approve-parking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parkingId, approve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process parking approval");
      setSuccess(`Parking listing ${approve ? "approved" : "rejected"} successfully.`);
      fetchStats();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleProcessPayout = async (payoutId, status) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/admin/approve-payout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ payoutId, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process withdrawal");
      setSuccess(`Payout withdrawal request marked as: ${status}.`);
      fetchStats();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="max-w-6xl mx-auto p-10 text-asphalt/60">Loading system metrics…</div>;
  }

  const { metrics = {}, pendingOwners = [], pendingParkings = [], pendingPayouts = [] } = stats || {};

  return (
    <div className="max-w-6xl mx-auto px-5 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-ink">Admin Dashboard</h1>
        <p className="text-asphalt/60 text-sm">Platform metrics, owner approvals, and withdrawals management.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 mb-6 text-sm">{success}</div>}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-10">
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Total Riders</p>
          <h3 className="text-2xl font-bold text-ink mt-1">{metrics.totalRiders}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Total Owners</p>
          <h3 className="text-2xl font-bold text-ink mt-1">{metrics.totalOwners}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Total Bookings</p>
          <h3 className="text-2xl font-bold text-ink mt-1">{metrics.totalBookings}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Gross Revenue</p>
          <h3 className="text-2xl font-bold text-signal mt-1">₹{metrics.grossRevenue?.toFixed(1)}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Commission (15%)</p>
          <h3 className="text-2xl font-bold text-ink mt-1">₹{metrics.platformCommission?.toFixed(1)}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Owner Payout Share</p>
          <h3 className="text-2xl font-bold text-ink mt-1">₹{metrics.netOwnerPayouts?.toFixed(1)}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Withdrawals Settled</p>
          <h3 className="text-2xl font-bold text-ink mt-1">₹{metrics.paidPayoutsSum?.toFixed(1)}</h3>
        </div>
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <p className="text-xs text-asphalt/50 uppercase font-semibold">Withdrawals Pending</p>
          <h3 className="text-2xl font-bold text-red-500 mt-1">₹{metrics.pendingPayoutsSum?.toFixed(1)}</h3>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Owner Approvals */}
        <div className="bg-white border border-black/5 rounded-2xl p-6 shadow-sm">
          <h3 className="font-display font-semibold text-lg mb-4 flex items-center justify-between">
            <span>Owner Approvals</span>
            <span className="text-xs bg-signal/10 text-signal px-2.5 py-0.5 rounded-full">{pendingOwners.length} pending</span>
          </h3>
          {pendingOwners.length === 0 ? (
            <p className="text-asphalt/50 text-sm">No pending owner registration approvals.</p>
          ) : (
            <div className="space-y-4">
              {pendingOwners.map((owner) => (
                <div key={owner.id} className="border border-black/5 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-ink">{owner.full_name}</p>
                    <p className="text-xs text-asphalt/60">Phone: {owner.phone || "N/A"}</p>
                    <p className="text-[10px] text-asphalt/40 mt-1">Registered: {new Date(owner.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveOwner(owner.id, false)}
                      className="text-xs border border-red-200 text-red-500 rounded-full px-3 py-1 hover:bg-red-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApproveOwner(owner.id, true)}
                      className="text-xs bg-signal text-white rounded-full px-4 py-1 hover:bg-signal/90"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Parking Listing Approvals */}
        <div className="bg-white border border-black/5 rounded-2xl p-6 shadow-sm">
          <h3 className="font-display font-semibold text-lg mb-4 flex items-center justify-between">
            <span>Parking Approvals</span>
            <span className="text-xs bg-signal/10 text-signal px-2.5 py-0.5 rounded-full">{pendingParkings.length} pending</span>
          </h3>
          {pendingParkings.length === 0 ? (
            <p className="text-asphalt/50 text-sm">No pending parking listing approvals.</p>
          ) : (
            <div className="space-y-4">
              {pendingParkings.map((p) => (
                <div key={p.id} className="border border-black/5 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-ink">{p.name}</p>
                    <p className="text-xs text-asphalt/60">{p.address}, {p.city}</p>
                    <p className="text-xs text-asphalt/60">Slots: {p.total_slots} · Rate: ₹{p.price_per_hour}/hr</p>
                    <p className="text-[10px] text-asphalt/40 mt-1">Owner: {p.profiles?.full_name}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveParking(p.id, false)}
                      className="text-xs border border-red-200 text-red-500 rounded-full px-3 py-1 hover:bg-red-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApproveParking(p.id, true)}
                      className="text-xs bg-signal text-white rounded-full px-4 py-1 hover:bg-signal/90"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Withdrawal Requests */}
        <div className="bg-white border border-black/5 rounded-2xl p-6 shadow-sm md:col-span-2">
          <h3 className="font-display font-semibold text-lg mb-4 flex items-center justify-between">
            <span>Withdrawals Queue</span>
            <span className="text-xs bg-signal/10 text-signal px-2.5 py-0.5 rounded-full">{pendingPayouts.length} pending</span>
          </h3>
          {pendingPayouts.length === 0 ? (
            <p className="text-asphalt/50 text-sm">No pending withdrawal requests to process.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/5 text-xs text-asphalt/50 uppercase font-semibold">
                    <th className="py-3">Owner</th>
                    <th className="py-3">Razorpay Link Account ID</th>
                    <th className="py-3">Amount</th>
                    <th className="py-3">Requested At</th>
                    <th className="py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {pendingPayouts.map((pay) => (
                    <tr key={pay.id} className="hover:bg-mist/50 transition">
                      <td className="py-4">
                        <p className="font-semibold text-ink">{pay.profiles?.full_name}</p>
                        <p className="text-xs text-asphalt/60">{pay.profiles?.phone || "No phone"}</p>
                      </td>
                      <td className="py-4 font-mono text-xs text-asphalt/70">{pay.profiles?.razorpay_account_id || "Manual Settlement required"}</td>
                      <td className="py-4 font-bold text-ink">₹{pay.amount}</td>
                      <td className="py-4 text-xs text-asphalt/60">{new Date(pay.requested_at).toLocaleString()}</td>
                      <td className="py-4 text-right flex justify-end gap-2">
                        <button
                          onClick={() => handleProcessPayout(pay.id, "failed")}
                          className="text-xs border border-red-200 text-red-500 rounded-full px-3 py-1 hover:bg-red-50"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleProcessPayout(pay.id, "paid")}
                          className="text-xs bg-green-600 text-white rounded-full px-4 py-1 hover:bg-green-700"
                        >
                          Mark Paid
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
