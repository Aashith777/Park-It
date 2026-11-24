import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await signIn(form);
    setLoading(false);
    if (error) setError(error.message);
    else navigate("/");
  };

  return (
    <div className="max-w-md mx-auto px-5 py-24">
      <h2 className="font-display text-2xl font-bold mb-1">Welcome back</h2>
      <p className="text-asphalt/60 mb-8">Log in to book or manage your parking.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
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
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="w-full border border-ink/15 rounded-lg px-4 py-3"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          disabled={loading}
          className="w-full bg-signal text-white rounded-full py-3 font-medium hover:bg-signal/90 disabled:opacity-50"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="text-sm text-asphalt/60 mt-6 text-center">
        No account? <Link to="/register" className="text-signal font-medium">Sign up</Link>
      </p>
    </div>
  );
}
