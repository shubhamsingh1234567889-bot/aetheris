const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** [west, south, east, north] box of roughly `radiusKm` around a point. */
export function bboxAround(lat: number, lon: number, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos(rad(lat))));
  return [
    Math.max(-180, lon - dLon),
    Math.max(-90, lat - dLat),
    Math.min(180, lon + dLon),
    Math.min(90, lat + dLat),
  ];
}
