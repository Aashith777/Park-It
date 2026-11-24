import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

export default function OwnerPayoutSetup() {
  const { session, profile } = useAuth();
  const [status, setStatus] = useState(null); // { razorpay_account_id, payout_onboarded }
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    businessName: "",
    legalBusinessName: "",
    businessType: "individual",
    email: session?.user?.email || "",
    phone: "",
    accountNumber: "",
    ifscCode: "",
    beneficiaryName: "",
  });

  const fetchStatus = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("razorpay_account_id, payout_onboarded")
      .eq("id", session.user.id)
      .single();
    setStatus(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/owner/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: session.user.id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onboarding failed");
      setSuccess(data.message || "Payout account created.");
      fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="max-w-md mx-auto px-5 py-16 text-asphalt/60">Loading…</p>;

  if (status?.payout_onboarded) {
    return (
      <div className="max-w-md mx-auto px-5 py-16">
        <h2 className="font-display text-2xl font-bold mb-1">Payouts are set up</h2>
        <p className="text-asphalt/60 mb-6">
          Your linked payout account is active. Each booking now automatically
          sends your 85% share to your bank account through Razorpay Route —
          you don't need to do anything else per booking.
        </p>
        <div className="bg-white rounded-2xl border border-black/5 p-5 text-sm">
          <p className="text-asphalt/50 text-xs mb-1">Linked account ID</p>
          <p className="font-mono text-ink">{status.razorpay_account_id}</p>
        </div>
        <p className="text-xs text-asphalt/50 mt-4">
          If Razorpay still needs KYC documents from you (PAN, bank proof,
          etc.) to fully activate payouts, check the email they sent when
          this account was created.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <h2 className="font-display text-2xl font-bold mb-1">Set up payouts</h2>
      <p className="text-asphalt/60 mb-8">
        Connect your bank details so your 85% share of every booking is paid
        out automatically — you never have to chase payments manually.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          required
          placeholder="Business / lot name (e.g. MG Road Parking Plaza)"
          value={form.businessName}
          onChange={(e) => setForm({ ...form, businessName: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />
        <input
          placeholder="Legal business name (if different)"
          value={form.legalBusinessName}
          onChange={(e) => setForm({ ...form, legalBusinessName: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />

        <select
          value={form.businessType}
          onChange={(e) => setForm({ ...form, businessType: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        >
          <option value="individual">Individual</option>
          <option value="proprietorship">Proprietorship</option>
          <option value="partnership">Partnership</option>
          <option value="private_limited">Private Limited Company</option>
          <option value="trust">Trust</option>
        </select>

        <input
          required
          type="email"
          placeholder="Email (for Razorpay KYC communication)"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />
        <input
          required
          placeholder="Phone number"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />

        <div className="h-px bg-black/5 my-2" />
        <p className="text-sm font-medium text-ink">Bank account for payouts</p>

        <input
          required
          placeholder="Beneficiary name (as per bank account)"
          value={form.beneficiaryName}
          onChange={(e) => setForm({ ...form, beneficiaryName: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />
        <input
          required
          placeholder="Bank account number"
          value={form.accountNumber}
          onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />
        <input
          required
          placeholder="IFSC code"
          value={form.ifscCode}
          onChange={(e) => setForm({ ...form, ifscCode: e.target.value.toUpperCase() })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && <p className="text-go text-sm">{success}</p>}

        <button
          disabled={submitting}
          className="w-full bg-signal text-white rounded-full py-3 font-medium hover:bg-signal/90 disabled:opacity-50"
        >
          {submitting ? "Setting up…" : "Set up automatic payouts"}
        </button>
      </form>

      <p className="text-xs text-asphalt/50 mt-6">
        Razorpay may email you afterward asking for PAN and bank proof
        documents before payouts fully activate — that's a one-time
        compliance step on their side, not something ParkSmart controls.
      </p>
    </div>
  );
}
