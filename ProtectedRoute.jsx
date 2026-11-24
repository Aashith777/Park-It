import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, requiredRole }) {
  const { session, profile, loading } = useAuth();

  if (loading) return <div className="text-center py-24 text-asphalt/60">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (requiredRole && profile?.role !== requiredRole) return <Navigate to="/" replace />;

  return children;
}
