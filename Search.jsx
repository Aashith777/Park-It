import { useEffect, useState } from "react";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";
import ParkingCard from "../components/ParkingCard";
import BookingModal from "../components/BookingModal";
import SearchHeatMap from "../components/SearchHeatMap";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

export default function Search() {
  const { session } = useAuth();
  
  // Coordinates and Location states
  const [coords, setCoords] = useState(null);
  const [detectedCity, setDetectedCity] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [cityOptions, setCityOptions] = useState([]);
  
  // UI & List States
  const [areas, setAreas] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [selectedArea, setSelectedArea] = useState(null);
  const [showMap, setShowMap] = useState(false);

  // Search Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [vehicleType, setVehicleType] = useState(""); // empty means 'all'
  const [maxPrice, setMaxPrice] = useState(150);
  const [maxDistance, setMaxDistance] = useState(15);
  const [needEV, setNeedEV] = useState(false);
  const [needCovered, setNeedCovered] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState("nearest");

  // Step 1: Detect user's current GPS location & reverse geocode
  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Location services are not supported by this browser. Pick a city manually.");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
          );
          const data = await res.json();
          const city = data.city || data.locality || data.principalSubdivision || "";
          setDetectedCity(city);
          setSelectedCity(city);
        } catch {
          setError("Couldn't auto-detect your city. Select manually.");
        }
        setLocating(false);
      },
      () => {
        setError("GPS access denied. Pick your city manually below.");
        setLocating(false);
      }
    );
  }, []);

  // Step 2: Load cities with active parking areas
  useEffect(() => {
    supabase.rpc("list_cities").then(({ data }) => setCityOptions(data || []));
  }, []);

  // Step 3: Load user's favorite parking list from backend
  const fetchFavorites = async () => {
    if (!session) return;
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/favorites/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFavorites(data.map((fav) => fav.id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (session) {
      fetchFavorites();
    }
  }, [session]);

  // Step 4: Toggle Favorites
  const toggleFavorite = async (parkingAreaId) => {
    try {
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/favorites/toggle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ parkingAreaId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.favorited) {
          setFavorites((prev) => [...prev, parkingAreaId]);
        } else {
          setFavorites((prev) => prev.filter((id) => id !== parkingAreaId));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Step 5: Fetch parking areas based on city & filter params
  const fetchParkingAreas = async () => {
    if (!selectedCity) {
      setAreas([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");

    try {
      const { data, error: rpcErr } = await supabase.rpc("parking_by_city", {
        target_city: selectedCity,
        user_lat: coords?.lat ?? null,
        user_lng: coords?.lng ?? null,
        v_type: vehicleType || null,
        need_ev: needEV,
        need_covered: needCovered,
        min_rating: Number(minRating),
        max_price: Number(maxPrice),
        sort_by: sortBy,
      });

      if (rpcErr) throw rpcErr;

      // Further client-side filtering for distance limits (in case user location coords are active)
      let filteredData = data || [];
      if (coords && maxDistance) {
        filteredData = filteredData.filter(
          (area) => area.distance_km === null || area.distance_km <= maxDistance
        );
      }

      setAreas(filteredData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParkingAreas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCity, coords, vehicleType, maxPrice, maxDistance, needEV, needCovered, minRating, sortBy]);

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      {/* Header section */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-black/5 pb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Find a Parking Spot</h1>
          <p className="text-asphalt/60 text-xs mt-1">
            {locating
              ? "🧭 Geo-locating your coordinates…"
              : detectedCity
              ? `📍 Location: ${detectedCity}`
              : "🗺️ City picker available below"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
            className="border border-ink/15 rounded-full px-4 py-2 text-sm bg-white font-medium"
          >
            <option value="" disabled>
              {locating ? "Detecting…" : "Select a city"}
            </option>
            {detectedCity && !cityOptions.some((c) => c.city === detectedCity) && (
              <option value={detectedCity}>{detectedCity} (Current)</option>
            )}
            {cityOptions.map((c) => (
              <option key={c.city} value={c.city}>{c.city}</option>
            ))}
          </select>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 border px-4 py-2 rounded-full text-sm font-medium transition ${
              showFilters ? "bg-signal text-white border-signal" : "border-ink/15 hover:bg-mist bg-white"
            }`}
          >
            🎛️ Filters
          </button>

          <button
            onClick={() => setShowMap(!showMap)}
            className={`flex items-center gap-2 border px-4 py-2 rounded-full text-sm font-medium transition ${
              showMap ? "bg-ink text-white border-ink" : "border-ink/15 hover:bg-mist bg-white"
            }`}
          >
            🗺️ {showMap ? "Hide Map" : "Show Map"}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white border border-black/5 rounded-2xl p-6 shadow-md mb-8 transition-all animate-fadeIn">
          <h3 className="font-display font-semibold text-base text-ink mb-4">Search Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Vehicle slot type */}
            <div>
              <label className="block text-xs font-bold text-asphalt/60 uppercase mb-2">Vehicle Type</label>
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                className="w-full border border-ink/15 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Any Vehicle Slot</option>
                <option value="bike">Bike</option>
                <option value="car">Car (Standard)</option>
                <option value="suv">SUV</option>
                <option value="ev">EV (Electric Vehicle)</option>
                <option value="truck">Truck / Lorry</option>
              </select>
            </div>

            {/* Min Rating */}
            <div>
              <label className="block text-xs font-bold text-asphalt/60 uppercase mb-2">Min Rating</label>
              <select
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                className="w-full border border-ink/15 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="0">All Ratings</option>
                <option value="3">⭐ 3.0+ Stars</option>
                <option value="4">⭐ 4.0+ Stars</option>
                <option value="4.5">⭐ 4.5+ Stars</option>
              </select>
            </div>

            {/* Sorting criteria */}
            <div>
              <label className="block text-xs font-bold text-asphalt/60 uppercase mb-2">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full border border-ink/15 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="nearest">Nearest First</option>
                <option value="price_low">Price: Low to High</option>
                <option value="rating_high">Highest Rated</option>
                <option value="ai_recommended">AI Recommended (Best Match)</option>
              </select>
            </div>

            {/* Price slider */}
            <div>
              <div className="flex justify-between text-xs font-bold text-asphalt/60 uppercase mb-2">
                <span>Max Price / Hour</span>
                <span className="text-signal font-semibold">₹{maxPrice}/hr</span>
              </div>
              <input
                type="range"
                min="20"
                max="250"
                step="10"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-signal"
              />
            </div>

            {/* Distance slider */}
            <div>
              <div className="flex justify-between text-xs font-bold text-asphalt/60 uppercase mb-2">
                <span>Max Distance</span>
                <span className="text-signal font-semibold">{maxDistance} km</span>
              </div>
              <input
                type="range"
                min="1"
                max="30"
                value={maxDistance}
                onChange={(e) => setMaxDistance(Number(e.target.value))}
                disabled={!coords}
                className="w-full accent-signal disabled:opacity-40"
              />
            </div>

            {/* Amenities check */}
            <div className="flex flex-col gap-2 justify-center pt-2">
              <label className="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={needCovered}
                  onChange={(e) => setNeedCovered(e.target.checked)}
                  className="rounded border-ink/15 text-signal focus:ring-signal w-4 h-4"
                />
                ☂️ Covered Parking space
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={needEV}
                  onChange={(e) => setNeedEV(e.target.checked)}
                  className="rounded border-ink/15 text-signal focus:ring-signal w-4 h-4"
                />
                ⚡ EV Charging Available
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Map Heat Map section */}
      {showMap && (
        <div className="mb-8">
          <SearchHeatMap
            areas={areas}
            userCoords={coords}
            onBook={setSelectedArea}
          />
        </div>
      )}

      {/* Status Toasts */}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-6 flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")} className="text-green-900 font-bold">×</button>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-6">
          {error}
        </div>
      )}

      {/* Main Grid */}
      {loading ? (
        <div className="py-20 text-center text-asphalt/60">Loading parking spaces…</div>
      ) : areas.length === 0 ? (
        <div className="text-center py-20 bg-white border border-black/5 rounded-2xl p-8">
          <p className="text-asphalt/50 font-medium">No active parking spots match your filter choices in {selectedCity || "this area"}.</p>
          <button
            onClick={() => {
              setVehicleType("");
              setMaxPrice(150);
              setMaxDistance(15);
              setNeedEV(false);
              setNeedCovered(false);
              setMinRating(0);
            }}
            className="mt-4 text-xs font-semibold bg-signal text-white rounded-full px-4 py-2 hover:bg-signal/90"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {areas.map((area) => (
            <div key={area.id} className="relative">
              {/* Highlight top AI recommendations */}
              {area.ai_score > 75 && (
                <div className="absolute -top-3 left-4 bg-gradient-to-r from-yellow-500 to-amber-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm z-10 flex items-center gap-1 border border-white">
                  <span>⭐ AI RECOMMENDED</span>
                  <span className="opacity-80">({area.ai_score}%)</span>
                </div>
              )}
              
              {/* Favorite Heart trigger icon */}
              <button
                onClick={() => toggleFavorite(area.id)}
                className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white p-2 rounded-full shadow-sm text-xs focus:outline-none transition active:scale-95"
              >
                {favorites.includes(area.id) ? (
                  <span className="text-red-500 text-sm">♥</span>
                ) : (
                  <span className="text-asphalt/40 text-sm">♡</span>
                )}
              </button>

              <ParkingCard area={area} onBook={setSelectedArea} />
            </div>
          ))}
        </div>
      )}

      {/* Booking Drawer Modal */}
      {selectedArea && (
        <BookingModal
          area={selectedArea}
          onClose={() => setSelectedArea(null)}
          onSuccess={() => {
            setSelectedArea(null);
            setSuccessMsg("Slot booked successfully! Check My Bookings for receipt, details & entry QR.");
            fetchParkingAreas();
          }}
        />
      )}
    </div>
  );
}
