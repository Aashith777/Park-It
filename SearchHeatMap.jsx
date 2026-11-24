import { useEffect, useRef } from "react";

export default function SearchHeatMap({ areas, userCoords, onBook }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layerGroupRef = useRef(null);

  useEffect(() => {
    if (!window.L || !mapContainerRef.current) return;

    // Determine initial center
    let center = [13.0827, 80.2707]; // Chennai default
    if (userCoords?.lat && userCoords?.lng) {
      center = [userCoords.lat, userCoords.lng];
    } else if (areas && areas.length > 0) {
      center = [areas[0].latitude, areas[0].longitude];
    }

    // Initialize map
    const map = window.L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView(center, 13);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    // Create a group layer for easy marker clearing
    const layerGroup = window.L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Update center when userCoords change if not already set
  useEffect(() => {
    if (mapRef.current && userCoords?.lat && userCoords?.lng) {
      mapRef.current.setView([userCoords.lat, userCoords.lng], 13);
    }
  }, [userCoords]);

  // Redraw colored circles whenever areas list changes
  useEffect(() => {
    if (!mapRef.current || !layerGroupRef.current || !areas) return;

    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;

    // Clear previous layers
    layerGroup.clearLayers();

    // User location marker
    if (userCoords?.lat && userCoords?.lng) {
      window.L.marker([userCoords.lat, userCoords.lng], {
        icon: window.L.divIcon({
          html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));">📍</div>',
          className: "",
          iconSize: [24, 24],
          iconAnchor: [12, 24],
        }),
      })
        .addTo(layerGroup)
        .bindPopup("Your Location");
    }

    // Draw occupancy heatmap circles for each parking area
    areas.forEach((area) => {
      const ratio = area.total_slots > 0 ? area.available_slots / area.total_slots : 0;
      
      // Heat Map color mapping: Green (Empty/Lots of space) -> Yellow (Medium occupancy) -> Red (Full/Critical occupancy)
      let color = "#10B981"; // Green (>= 70% free)
      let occupancyText = "Empty (Plenty of slots)";
      
      if (ratio < 0.1) {
        color = "#EF4444"; // Red (< 10% free)
        occupancyText = "Full / High Demand";
      } else if (ratio < 0.7) {
        color = "#F59E0B"; // Yellow (10% to 70% free)
        occupancyText = "Medium Occupancy";
      }

      // Draw occupancy outer bounds circle
      const circle = window.L.circle([area.latitude, area.longitude], {
        color: color,
        fillColor: color,
        fillOpacity: 0.25,
        radius: 120, // 120 meters radius coverage
      }).addTo(layerGroup);

      // Create a marker inside the circle to display lot info on popup click
      const marker = window.L.marker([area.latitude, area.longitude], {
        icon: window.L.divIcon({
          html: `<div style="background-color: ${color}; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">P</div>`,
          className: "",
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(layerGroup);

      // Construct popup HTML
      const popupHtml = document.createElement("div");
      popupHtml.className = "p-2 font-sans";
      popupHtml.style.minWidth = "180px";
      popupHtml.innerHTML = `
        <h4 class="font-bold text-sm text-ink m-0">${area.name}</h4>
        <p class="text-xs text-asphalt/70 mt-1 mb-1">${area.address}</p>
        <div class="flex items-center gap-1.5 mt-1.5">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${color};"></span>
          <span class="text-xs font-semibold" style="color:${color};">${occupancyText}</span>
        </div>
        <p class="text-xs font-medium mt-1 text-ink">Slots: <strong>${area.available_slots}</strong> / ${area.total_slots} free</p>
        <p class="text-xs font-bold mt-1 text-signal">₹${area.price_per_hour}/hr</p>
        <button id="btn-book-${area.id}" class="mt-2.5 w-full bg-signal text-white text-[11px] font-bold rounded-full py-1.5 hover:bg-signal/90 transition border-0 cursor-pointer">Book Slot</button>
      `;

      // Attach click action to popup button
      marker.bindPopup(popupHtml);
      circle.on("click", () => marker.openPopup());

      marker.on("popupopen", () => {
        const btn = document.getElementById(`btn-book-${area.id}`);
        if (btn) {
          btn.addEventListener("click", () => {
            onBook(area);
            marker.closePopup();
          });
        }
      });
    });

    // Fit map bounds to show all markers if areas exist
    if (areas.length > 0) {
      const bounds = areas.map((a) => [a.latitude, a.longitude]);
      if (userCoords?.lat && userCoords?.lng) {
        bounds.push([userCoords.lat, userCoords.lng]);
      }
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [areas, userCoords]);

  return (
    <div className="rounded-2xl overflow-hidden border border-black/5 shadow-inner">
      <div ref={mapContainerRef} style={{ height: "400px", width: "100%" }} />
      <div className="bg-mist px-4 py-2 text-xs text-asphalt/60 flex items-center justify-between flex-wrap gap-2 border-t border-black/5">
        <span className="font-medium">🔴 Live Heat Map:</span>
        <div className="flex gap-4">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" /> Empty (&gt;70% free)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" /> Medium (10%-70%)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]" /> Full (&lt;10% free)</span>
        </div>
      </div>
    </div>
  );
}
