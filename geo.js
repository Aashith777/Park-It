// Straight-line (Haversine) distance between two coordinates, in kilometers.
// This matches the same formula used server-side in supabase/schema.sql,
// so the number shown here lines up with what the search results show.
export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Rough ETA estimate: distance / average speed. This is intentionally simple -
// it does NOT account for live traffic, one-way streets, or actual road routes
// (that requires a paid routing API like Google Directions or Mapbox
// Directions). It gives users a reasonable ballpark, clearly labeled as an
// estimate, without adding billing/API-key complexity to the project.
export function estimateEtaMinutes(distanceKm, avgSpeedKmph = 25) {
  return Math.max(1, Math.round((distanceKm / avgSpeedKmph) * 60));
}
