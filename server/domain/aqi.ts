export interface AqiCategory {
  level: 'good' | 'moderate' | 'unhealthy_sensitive' | 'unhealthy' | 'very_unhealthy' | 'hazardous';
  label: string;
}

/** US EPA AQI bands (also used by WAQI and Open-Meteo `us_aqi`). */
export function aqiCategory(aqi: number): AqiCategory {
  if (aqi <= 50) return { level: 'good', label: 'Good' };
  if (aqi <= 100) return { level: 'moderate', label: 'Moderate' };
  if (aqi <= 150) return { level: 'unhealthy_sensitive', label: 'Unhealthy for sensitive groups' };
  if (aqi <= 200) return { level: 'unhealthy', label: 'Unhealthy' };
  if (aqi <= 300) return { level: 'very_unhealthy', label: 'Very unhealthy' };
  return { level: 'hazardous', label: 'Hazardous' };
}
