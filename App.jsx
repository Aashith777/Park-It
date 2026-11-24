import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import ProtectedRoute from "./components/ProtectedRoute";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Search from "./pages/Search";
import MyBookings from "./pages/MyBookings";
import AddParking from "./pages/AddParking";
import OwnerDashboard from "./pages/OwnerDashboard";
import OwnerPayoutSetup from "./pages/OwnerPayoutSetup";
import OwnerScanner from "./pages/OwnerScanner";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route
            path="/search"
            element={
              <ProtectedRoute requiredRole="rider">
                <Search />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-bookings"
            element={
              <ProtectedRoute requiredRole="rider">
                <MyBookings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner/add-parking"
            element={
              <ProtectedRoute requiredRole="owner">
                <AddParking />
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner/dashboard"
            element={
              <ProtectedRoute requiredRole="owner">
                <OwnerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner/payout-setup"
            element={
              <ProtectedRoute requiredRole="owner">
                <OwnerPayoutSetup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner/scan"
            element={
              <ProtectedRoute requiredRole="owner">
                <OwnerScanner />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
