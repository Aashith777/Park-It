import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [searchParams] = useSearchParams();
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    role: searchParams.get("role") === "owner" ? "owner" : "rider",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await signUp({
      email: form.email,
      password: form.password,
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setDone(true);
  };

  if (done) {
    return (
      <div className="max-w-md mx-auto px-5 py-24 text-center">
        <h2 className="font-display text-2xl font-bold mb-3">Check your inbox</h2>
        <p className="text-asphalt/70">
          We sent a confirmation link to {form.email}. Confirm it, then log in below.
        </p>
        <button
          onClick={() => navigate("/login")}
          className="mt-6 bg-signal text-white px-6 py-3 rounded-full font-medium"
        >
          Go to login
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <h2 className="font-display text-2xl font-bold mb-1">Create your account</h2>
      <p className="text-asphalt/60 mb-8">Book slots as a rider, or list your lot as an owner.</p>

      <div className="flex rounded-full border border-ink/15 p-1 mb-6">
        {["rider", "owner"].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setForm({ ...form, role: r })}
            className={`flex-1 py-2 rounded-full text-sm font-medium capitalize transition ${
              form.role === r ? "bg-ink text-white" : "text-asphalt/60"
            }`}
          >
            {r === "rider" ? "I need parking" : "I own a lot"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          required
          placeholder="Full name"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />
        <input
          required
          type="email"
          placeholder="Email"
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
        <input
          required
          type="password"
          minLength={6}
          placeholder="Password (min 6 characters)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          disabled={loading}
          className="w-full bg-signal text-white rounded-full py-3 font-medium hover:bg-signal/90 disabled:opacity-50"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
