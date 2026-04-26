/**
 * Google Solar API client + system-recommendation engine.
 * Pure functions — no DOM, safe to import anywhere.
 */

export interface RoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: { areaMeters2: number };
  center?: { latitude: number; longitude: number };
}

export interface SolarPotential {
  roofSegmentStats?: RoofSegment[];
  wholeRoofStats?: { areaMeters2: number };
  maxArrayPanelsCount?: number;
  maxArrayAreaMeters2?: number;
  maxSunshineHoursPerYear?: number;
}

export interface SolarResponse {
  solarPotential?: SolarPotential;
  error?: { message?: string };
}

export async function fetchSolar(
  lat: number,
  lon: number,
  apiKey: string,
  quality: "HIGH" | "MEDIUM" | "LOW" = "HIGH",
): Promise<SolarResponse> {
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lon}` +
    `&requiredQuality=${quality}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  return res.json();
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  display_name: string;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
  );
  const data = await res.json();
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display_name: data[0].display_name,
  };
}

export interface Suggestion {
  lat: string;
  lon: string;
  display_name: string;
  type: string;
}

export async function fetchSuggestions(query: string): Promise<Suggestion[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}` +
      `&limit=5&countrycodes=de&addressdetails=1`,
  );
  return res.json();
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export function azimuthToDir(deg: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round(deg / 45) % 8]!;
}

// ── Recommendation ──────────────────────────────────────────────────────────
export interface Recommendation {
  recPanels: number;
  recKwp: number;
  recProduction: number;
  batteryKwh: number;
  inverterKw: number;
  targetPanels: number;
  maxPanels: number;
  maxUsablePanels: number;
  usableArea: number;
  systemCost: number;
  annualSavings: number;
  paybackYears: number;
  roi20y: number;
  totalSavings20y: number;
  selfConsumed: number;
  exported: number;
  usableSegments: RoofSegment[];
}

const PANEL_WP = 475;
const PANEL_AREA = 1.96;
const PERF_RATIO = 0.8;
const ELECTRICITY_PRICE = 0.35;
const PRICE_INCREASE = 0.03;
const SYSTEM_COST_PER_KWP = 1400;
const BATTERY_COST_PER_KWH = 800;
const FEEDIN_TARIFF = 0.08;

export function recommendSystem(
  demandKwh: number,
  maxPanels: number,
  sunshine: number,
  segments: RoofSegment[] | undefined,
): Recommendation {
  const yieldPerKwp = sunshine * PERF_RATIO;

  const usableSegments = (segments ?? []).filter((seg) => {
    if (seg.pitchDegrees > 45) return false;
    const dir = azimuthToDir(seg.azimuthDegrees);
    if (dir === "N" && seg.pitchDegrees > 15) return false;
    return true;
  });
  const usableArea = usableSegments.reduce((s, seg) => s + seg.stats.areaMeters2, 0);
  const maxUsablePanels = Math.min(maxPanels, Math.floor(usableArea / PANEL_AREA));

  const targetKwp = demandKwh / Math.max(yieldPerKwp, 1);
  const targetPanels = Math.ceil(targetKwp / (PANEL_WP / 1000));
  const recPanels = Math.min(targetPanels, maxUsablePanels);
  const recKwp = (recPanels * PANEL_WP) / 1000;
  const recProduction = recKwp * yieldPerKwp;

  const rawBattery = recKwp * 1.0;
  const batteryKwh = rawBattery <= 6 ? 5 : rawBattery <= 12 ? 10 : 15;

  const rawInverter = recKwp * 0.9;
  const inverterKw =
    rawInverter <= 6 ? 5 : rawInverter <= 9 ? 8 : rawInverter <= 12 ? 10 : 15;

  const SELF_CONSUMPTION_RATIO = batteryKwh > 0 ? 0.65 : 0.35;
  const systemCost = recKwp * SYSTEM_COST_PER_KWP + batteryKwh * BATTERY_COST_PER_KWH;
  const selfConsumed = recProduction * SELF_CONSUMPTION_RATIO;
  const exported = recProduction - selfConsumed;
  const annualSavings = selfConsumed * ELECTRICITY_PRICE + exported * FEEDIN_TARIFF;
  const paybackYears = annualSavings > 0 ? systemCost / annualSavings : Infinity;

  let totalSavings20y = 0;
  for (let y = 0; y < 20; y++) {
    const price = ELECTRICITY_PRICE * Math.pow(1 + PRICE_INCREASE, y);
    totalSavings20y += selfConsumed * price + exported * FEEDIN_TARIFF;
  }
  const roi20y = totalSavings20y - systemCost;

  return {
    recPanels,
    recKwp,
    recProduction,
    batteryKwh,
    inverterKw,
    targetPanels,
    maxPanels,
    maxUsablePanels,
    usableArea,
    systemCost,
    annualSavings,
    paybackYears,
    roi20y,
    totalSavings20y,
    selfConsumed,
    exported,
    usableSegments,
  };
}

export interface OfferItem {
  type: string;
  name: string;
  brand: string;
  qty: number;
  unit: string;
}

export function generateOffer(rec: Recommendation): OfferItem[] {
  return [
    { type: "Module", name: "Solar Panel 475W", brand: "Sunpro", qty: rec.recPanels, unit: "pcs" },
    {
      type: "Inverter",
      name: `Hybrid Inverter ${rec.inverterKw}kW`,
      brand: "Sigenergy",
      qty: 1,
      unit: "pcs",
    },
    {
      type: "BatteryStorage",
      name: `Battery ${rec.batteryKwh}kWh`,
      brand: "Sigenergy",
      qty: 1,
      unit: "pcs",
    },
    {
      type: "Mounting",
      name: "Roof Mounting System",
      brand: "SL Rack",
      qty: rec.recPanels,
      unit: "pcs",
    },
    { type: "InstallationFee", name: "Installation Solar + Storage", brand: "", qty: 1, unit: "" },
    { type: "ServiceFee", name: "Grid Registration", brand: "", qty: 1, unit: "" },
    { type: "ServiceFee", name: "System Planning & Design", brand: "", qty: 1, unit: "" },
    { type: "ServiceFee", name: "Delivery to Site", brand: "", qty: 1, unit: "" },
  ];
}

export const SERVICE_TYPES = new Set(["InstallationFee", "ServiceFee"]);
