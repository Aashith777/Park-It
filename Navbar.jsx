import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useState, useEffect, useRef } from "react";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

export default function Navbar() {
  const { session, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef(null);

  const fetchNotifications = async () => {
    if (!session) return;
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/notifications/me`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data || []);
      }
    } catch (err) {
      console.error("Failed to load notifications", err);
    }
  };

  useEffect(() => {
    if (session) {
      fetchNotifications();
      // Poll notifications every 30 seconds
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
    }
  }, [session]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id) => {
    try {
      await fetch(`${PAYMENT_SERVER_URL}/api/notifications/${id}/read`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch(`${PAYMENT_SERVER_URL}/api/notifications/read-all`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <nav className="sticky top-0 z-40 bg-ink text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" className="font-display text-xl font-bold tracking-tight flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-signal inline-block" />
          ParkIT
        </Link>

        <div className="flex items-center gap-6 text-sm font-medium">
          {session ? (
            <>
              {profile?.role === "admin" && (
                <Link to="/admin/dashboard" className="hover:text-signal transition text-yellow-400">Admin Panel</Link>
              )}
              {profile?.role === "owner" && (
                <>
                  <Link to="/owner/dashboard" className="hover:text-signal transition">Dashboard</Link>
                  <Link to="/owner/scan" className="hover:text-signal transition">Scan QR</Link>
                  <Link to="/owner/add-parking" className="hover:text-signal transition">Add Parking</Link>
                  <Link to="/owner/payout-setup" className="hover:text-signal transition">Payouts</Link>
                </>
              )}
              {profile?.role === "rider" && (
                <>
                  <Link to="/search" className="hover:text-signal transition">Find Parking</Link>
                  <Link to="/my-bookings" className="hover:text-signal transition">My Bookings</Link>
                </>
              )}

              {/* Notifications Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 text-white/80 hover:text-white transition focus:outline-none"
                  aria-label="Notifications"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 bg-signal text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white text-ink rounded-2xl shadow-xl border border-black/5 overflow-hidden z-50">
                    <div className="px-4 py-3 bg-mist border-b border-black/5 flex items-center justify-between">
                      <span className="font-semibold text-sm">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="text-xs text-signal hover:underline"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-black/5">
                      {notifications.length === 0 ? (
                        <p className="text-center py-6 text-asphalt/60 text-xs">No notifications yet</p>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => handleMarkAsRead(n.id)}
                            className={`p-4 hover:bg-mist cursor-pointer transition ${!n.is_read ? 'bg-signal/5 border-l-4 border-signal' : ''}`}
                          >
                            <h4 className="font-bold text-xs flex justify-between">
                              <span>{n.title}</span>
                              <span className="text-[10px] text-asphalt/40 font-normal">
                                {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </h4>
                            <p className="text-xs text-asphalt/70 mt-1 leading-relaxed">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pl-2 border-l border-white/10">
                <span className="text-xs bg-white/10 px-3 py-1 rounded-full text-white/80">
                  ₹{Number(profile?.wallet_balance || 0).toFixed(0)}
                </span>
                <button
                  onClick={handleSignOut}
                  className="bg-white/15 hover:bg-white/25 px-4 py-1.5 rounded-full transition"
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <Link to="/login" className="hover:text-signal transition">Log in</Link>
              <Link
                to="/register"
                className="bg-signal hover:bg-signal/90 px-4 py-2 rounded-full transition"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
