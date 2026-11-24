import { estimateEtaMinutes } from "../utils/geo";

export default function ParkingCard({ area, onBook }) {
  const navigationUrl = `https://www.google.com/maps/dir/?api=1&destination=${area.latitude},${area.longitude}`;
  const etaMinutes = area.distance_km != null ? estimateEtaMinutes(area.distance_km) : null;

  return (
    <div className="bg-white rounded-2xl border border-black/5 p-5 shadow-sm hover:shadow-md transition flex flex-col gap-3 relative h-full justify-between">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display font-semibold text-lg text-ink leading-tight">{area.name}</h3>
            <p className="text-xs text-asphalt/60 mt-1">{area.address}{area.city ? `, ${area.city}` : ""}</p>
            {area.review_count > 0 && (
              <p className="text-xs text-asphalt/60 mt-1.5 flex items-center gap-1">
                <span className="text-amber-400">⭐</span> <strong>{area.avg_rating}</strong> 
                <span className="text-asphalt/40">({area.review_count} reviews)</span>
              </p>
            )}
          </div>
          {area.distance_km != null && (
            <span className="text-[10px] font-bold bg-go/10 text-go px-2.5 py-1 rounded-full whitespace-nowrap">
              {area.distance_km.toFixed(1)} km · ~{etaMinutes} min
            </span>
          )}
        </div>

        {/* Feature Badges */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {area.is_covered && (
            <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-md">
              ☂️ Covered
            </span>
          )}
          {area.has_ev_slot && (
            <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-md">
              ⚡ EV Charging
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-black/5">
        <div className="flex items-center justify-between text-sm mb-4">
          <span className="text-asphalt/70 text-xs">
            Slots: <strong className="text-ink text-sm">{area.available_slots}</strong> / {area.total_slots} free
          </span>
          <span className="font-display font-semibold text-ink text-base">₹{area.price_per_hour}/hr</span>
        </div>

        <div className="flex gap-2">
          <a
            href={navigationUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center text-xs font-semibold border border-ink/15 rounded-full py-2 hover:bg-mist transition text-ink"
          >
            Navigate
          </a>
          <button
            onClick={() => onBook(area)}
            disabled={area.available_slots < 1}
            className="flex-1 text-xs font-semibold bg-signal text-white rounded-full py-2 hover:bg-signal/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {area.available_slots < 1 ? "Full" : "Book slot"}
          </button>
        </div>
      </div>
    </div>
  );
}
