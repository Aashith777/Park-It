import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../api/supabaseClient";
import { useAuth } from "../context/AuthContext";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;

export default function AddParking() {
  const { session } = useAuth();
  const navigate = useNavigate();
  
  // Basic Info Form
  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    latitude: "",
    longitude: "",
    isCovered: false,
  });

  // Multiple Slot Types pricing config
  const [slotsConfig, setSlotsConfig] = useState({
    bike: { enabled: true, total: 10, price: 10 },
    car: { enabled: true, total: 20, price: 20 },
    suv: { enabled: false, total: 5, price: 30 },
    ev: { enabled: false, total: 5, price: 25 },
    truck: { enabled: false, total: 2, price: 50 },
  });

  // Uploaded Image URLs
  const [images, setImages] = useState({
    front_gate: "",
    entry: "",
    exit: "",
    slots: "",
  });

  const [uploading, setUploading] = useState({
    front_gate: false,
    entry: false,
    exit: false,
    slots: false,
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detectingCity, setDetectingCity] = useState(false);

  const useMyLocation = () => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const latitude = pos.coords.latitude.toFixed(6);
      const longitude = pos.coords.longitude.toFixed(6);
      setForm((f) => ({ ...f, latitude, longitude }));

      setDetectingCity(true);
      try {
        const res = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
        );
        const data = await res.json();
        const detectedCity = data.city || data.locality || data.principalSubdivision || "";
        setForm((f) => ({ ...f, city: detectedCity }));
      } catch {
        // Fallback
      }
      setDetectingCity(false);
    });
  };

  // Decode file and post to image uploads API
  const handleImageChange = async (e, field) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading((prev) => ({ ...prev, [field]: true }));
    setError("");

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const res = await fetch(`${PAYMENT_SERVER_URL}/api/uploads/image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            imageBase64: reader.result,
            filename: `${field}_lot`,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          setImages((prev) => ({ ...prev, [field]: data.url }));
        } else {
          setError(data.error || "Failed to upload image");
        }
      } catch (err) {
        setError("Image upload failed.");
      } finally {
        setUploading((prev) => ({ ...prev, [field]: false }));
      }
    };
  };

  const handleSlotToggle = (type) => {
    setSlotsConfig((prev) => ({
      ...prev,
      [type]: { ...prev[type], enabled: !prev[type].enabled },
    }));
  };

  const handleSlotNumChange = (type, field, val) => {
    setSlotsConfig((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: Number(val) },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Calculate sum of enabled slots
    const activeSlots = Object.keys(slotsConfig)
      .filter((k) => slotsConfig[k].enabled)
      .map((k) => slotsConfig[k]);

    if (activeSlots.length === 0) {
      setError("Please enable and configure at least one vehicle slot type.");
      setLoading(false);
      return;
    }

    const totalSlotsSum = activeSlots.reduce((sum, s) => sum + s.total, 0);
    // Find car price or first enabled price to populate base column price_per_hour
    const basePrice = slotsConfig.car.enabled ? slotsConfig.car.price : activeSlots[0].price;

    try {
      // 1. Create parking area entry (starts as unapproved, awaiting admin approval)
      const { data: area, error: insertErr } = await supabase
        .from("parking_areas")
        .insert({
          owner_id: session.user.id,
          name: form.name,
          address: form.address,
          city: form.city,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          total_slots: totalSlotsSum,
          available_slots: totalSlotsSum,
          price_per_hour: basePrice,
          is_covered: form.isCovered,
          is_approved: false, // requires admin approval
          image_front_gate: images.front_gate || null,
          image_entry: images.entry || null,
          image_exit: images.exit || null,
          image_slots: images.slots || null,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // 2. Create slot rows for each enabled vehicle type
      const slotInsertRows = Object.keys(slotsConfig)
        .filter((k) => slotsConfig[k].enabled)
        .map((type) => ({
          parking_area_id: area.id,
          slot_type: type,
          total_slots: slotsConfig[type].total,
          available_slots: slotsConfig[type].total,
          price_per_hour: slotsConfig[type].price,
        }));

      const { error: slotsErr } = await supabase
        .from("parking_slots")
        .insert(slotInsertRows);

      if (slotsErr) throw slotsErr;

      navigate("/owner/dashboard");
    } catch (err) {
      setError(err.message || "Failed to create parking area listing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-5 py-12">
      <h2 className="font-display text-2xl font-bold mb-1">List a Parking Space</h2>
      <p className="text-asphalt/60 text-sm mb-6">Complete all fields. Your listing will go public once approved by the administrator.</p>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3 mb-6">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic section */}
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-sm text-ink mb-1">1. Basic Information</h3>
          <input
            required
            placeholder="Parking Lot Name (e.g. Metro Space)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-ink/15 rounded-xl px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Complete Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full border border-ink/15 rounded-xl px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              required
              placeholder="Latitude"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              className="w-1/2 border border-ink/15 rounded-xl px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Longitude"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              className="w-1/2 border border-ink/15 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            className="text-xs text-signal font-semibold hover:underline"
          >
            🎯 Fetch Current Location GPS Coordinates
          </button>
          
          <input
            required
            placeholder="City (e.g. Chennai)"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full border border-ink/15 rounded-xl px-3 py-2 text-sm"
          />
          {detectingCity && <p className="text-[10px] text-asphalt/40">Detecting City…</p>}

          <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={form.isCovered}
              onChange={(e) => setForm({ ...form, isCovered: e.target.checked })}
              className="rounded border-ink/15 text-signal focus:ring-signal w-4 h-4"
            />
            ☂️ This parking lot is covered/sheltered
          </label>
        </div>

        {/* Vehicle Slots and Pricing section */}
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
          <h3 className="font-semibold text-sm text-ink mb-1">2. Vehicle Slots & Hourly Rates</h3>
          <p className="text-[11px] text-asphalt/50 mb-4">Enable the slot types supported at your facility and configure prices.</p>

          <div className="space-y-4">
            {["bike", "car", "suv", "ev", "truck"].map((type) => {
              const config = slotsConfig[type];
              return (
                <div key={type} className="flex flex-wrap items-center justify-between gap-4 border-b border-black/5 pb-3 last:border-b-0 last:pb-0">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-ink capitalize">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={() => handleSlotToggle(type)}
                      className="rounded border-ink/15 text-signal focus:ring-signal w-4 h-4"
                    />
                    <span>
                      {type === "bike" ? "🏍️" : type === "car" ? "🚗" : type === "suv" ? "🚙" : type === "ev" ? "⚡" : "🚛"}
                    </span>
                    <span>{type} Slot</span>
                  </label>

                  {config.enabled && (
                    <div className="flex gap-2 items-center">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-asphalt/50">Capacity:</span>
                        <input
                          type="number"
                          min="1"
                          required
                          value={config.total}
                          onChange={(e) => handleSlotNumChange(type, "total", e.target.value)}
                          className="w-16 border border-ink/15 rounded-lg px-2 py-1 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-asphalt/50">Price/hr:</span>
                        <input
                          type="number"
                          min="0"
                          required
                          value={config.price}
                          onChange={(e) => handleSlotNumChange(type, "price", e.target.value)}
                          className="w-16 border border-ink/15 rounded-lg px-2 py-1 text-xs"
                        />
                        <span className="text-[10px] text-asphalt/50">₹</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Images uploads section */}
        <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-sm text-ink mb-1">3. Parking Lot Images</h3>
          <p className="text-[11px] text-asphalt/50 mb-3">Upload visual photos to help riders locate and verify slot access points.</p>

          <div className="grid grid-cols-2 gap-4">
            {/* Front Gate */}
            <div>
              <label className="block text-[10px] uppercase font-bold text-asphalt/60 mb-1">Front Gate</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageChange(e, "front_gate")}
                className="w-full text-xs text-asphalt/70"
              />
              {uploading.front_gate && <span className="text-[9px] text-signal font-semibold">Uploading…</span>}
              {images.front_gate && <span className="text-[9px] text-green-600 font-semibold block mt-1">✓ Uploaded successfully</span>}
            </div>

            {/* Entry */}
            <div>
              <label className="block text-[10px] uppercase font-bold text-asphalt/60 mb-1">Entry Way</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageChange(e, "entry")}
                className="w-full text-xs text-asphalt/70"
              />
              {uploading.entry && <span className="text-[9px] text-signal font-semibold">Uploading…</span>}
              {images.entry && <span className="text-[9px] text-green-600 font-semibold block mt-1">✓ Uploaded successfully</span>}
            </div>

            {/* Exit */}
            <div>
              <label className="block text-[10px] uppercase font-bold text-asphalt/60 mb-1">Exit Route</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageChange(e, "exit")}
                className="w-full text-xs text-asphalt/70"
              />
              {uploading.exit && <span className="text-[9px] text-signal font-semibold">Uploading…</span>}
              {images.exit && <span className="text-[9px] text-green-600 font-semibold block mt-1">✓ Uploaded successfully</span>}
            </div>

            {/* Slots */}
            <div>
              <label className="block text-[10px] uppercase font-bold text-asphalt/60 mb-1">Parking Slots</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageChange(e, "slots")}
                className="w-full text-xs text-asphalt/70"
              />
              {uploading.slots && <span className="text-[9px] text-signal font-semibold">Uploading…</span>}
              {images.slots && <span className="text-[9px] text-green-600 font-semibold block mt-1">✓ Uploaded successfully</span>}
            </div>
          </div>
        </div>

        <button
          disabled={loading || Object.values(uploading).some(Boolean)}
          className="w-full bg-signal text-white rounded-full py-3 text-sm font-bold hover:bg-signal/90 disabled:opacity-50 transition"
        >
          {loading ? "Submitting Listing…" : "Register Parking Listing"}
        </button>
      </form>
    </div>
  );
}
