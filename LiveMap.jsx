import { useEffect, useRef, useState } from "react";
import { haversineDistanceKm, estimateEtaMinutes } from "../utils/geo";

// Shows a small live map with:
//  📍 the rider's current location (updates as they move)
//  🅿️ the parking area's location
//  a line connecting them
//  live-updating distance + estimated arrival time
//
// Uses Leaflet + OpenStreetMap tiles (loaded via CDN in index.html) - free,
// no API key or billing required, unlike the Google Maps JS SDK.
export default function LiveMap({ destination, height = 220, onArrival, arrivalThresholdKm = 0.05 }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const lineRef = useRef(null);
  const watchIdRef = useRef(null);
  const hasFiredArrivalRef = useRef(false);

  const [userCoords, setUserCoords] = useState(null);
  const [error, setError] = useState("");

  // Track the rider's live position
  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Live location isn't supported in this browser.");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError("Enable location access to see live distance and ETA."),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // Initialize the map once
  useEffect(() => {
    if (!window.L || !mapContainerRef.current || mapRef.current) return;

    const map = window.L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([destination.lat, destination.lng], 14);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    destMarkerRef.current = window.L.marker([destination.lat, destination.lng], {
      icon: window.L.divIcon({
        html: '<div style="font-size:22px;line-height:1;">🅿️</div>',
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 20],
      }),
    })
      .addTo(map)
      .bindPopup(destination.name);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update the user's marker and re-fit the map whenever their position changes
  useEffect(() => {
    if (!mapRef.current || !userCoords) return;
    const map = mapRef.current;
    const userLatLng = [userCoords.lat, userCoords.lng];
    const destLatLng = [destination.lat, destination.lng];

    if (!userMarkerRef.current) {
      userMarkerRef.current = window.L.marker(userLatLng, {
        icon: window.L.divIcon({
          html: '<div style="font-size:20px;line-height:1;">📍</div>',
          className: "",
          iconSize: [22, 22],
          iconAnchor: [11, 20],
        }),
      })
        .addTo(map)
        .bindPopup("You");
    } else {
      userMarkerRef.current.setLatLng(userLatLng);
    }

    if (lineRef.current) map.removeLayer(lineRef.current);
    lineRef.current = window.L.polyline([userLatLng, destLatLng], {
      color: "#FF6B35",
      weight: 3,
      dashArray: "6, 6",
    }).addTo(map);

    map.fitBounds([userLatLng, destLatLng], { padding: [30, 30] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords]);

  const distanceKm = userCoords
    ? haversineDistanceKm(userCoords.lat, userCoords.lng, destination.lat, destination.lng)
    : null;
  const etaMinutes = distanceKm != null ? estimateEtaMinutes(distanceKm) : null;

  // Fire the arrival callback once (not proof of check-in - just a helpful
  // nudge to the rider; the QR scan is what actually confirms entry).
  useEffect(() => {
    if (distanceKm != null && distanceKm <= arrivalThresholdKm && !hasFiredArrivalRef.current) {
      hasFiredArrivalRef.current = true;
      onArrival && onArrival();
    }
  }, [distanceKm, arrivalThresholdKm, onArrival]);

  const navigationUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`;

  return (
    <div className="rounded-xl overflow-hidden border border-black/5">
      <div ref={mapContainerRef} style={{ height, width: "100%" }} />

      <div className="bg-white px-4 py-3 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-asphalt/50 text-xs">Distance</p>
            <p className="font-semibold text-ink">
              {distanceKm != null ? `${distanceKm.toFixed(1)} km` : "—"}
            </p>
          </div>
          <div>
            <p className="text-asphalt/50 text-xs">Est. arrival</p>
            <p className="font-semibold text-ink">
              {etaMinutes != null ? `~${etaMinutes} min` : "—"}
            </p>
          </div>
        </div>
        <a
          href={navigationUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium bg-ink text-white px-3 py-2 rounded-full whitespace-nowrap hover:bg-ink/90 transition"
        >
          🧭 Start navigation
        </a>
      </div>

      {error && <p className="text-xs text-red-600 px-4 pb-3 bg-white">{error}</p>}
    </div>
  );
}
