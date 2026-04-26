/**
 * Client-side KNN over the Reonic project dataset.
 * Loads /data/projects_combined.csv once and caches the encoded matrix.
 */

export const KNN_CONTINUOUS = [
  "energy_demand_wh",
  "energy_price_per_wh",
  "energy_price_increase",
] as const;
export const KNN_BOOLEANS = [
  "has_ev",
  "has_solar",
  "has_storage",
  "has_wallbox",
] as const;
export const KNN_ORDER_COLS = [
  "ordered_solar",
  "ordered_battery",
  "ordered_wallbox",
  "ordered_heatpump",
] as const;
export const KNN_ORDER_LABELS = ["Solar", "Battery", "Wallbox", "Heat pump"] as const;

export const FOSSIL_FUELS = new Set(["Gas", "Oil", "OtherNonRenewable"]);

export type Row = Record<string, string>;

export interface KNNQuery {
  energy_demand_wh: string;
  energy_price_per_wh: string;
  energy_price_increase: string;
  has_ev: "True" | "False";
  has_solar: "True" | "False";
  has_storage: "True" | "False";
  has_wallbox: "True" | "False";
  country: string;
  heating_existing_type: string;
}

export interface KNNCache {
  rows: Row[];
  scaled: number[][];
  medians: number[];
  means: number[];
  stds: number[];
  encode: (r: Row | KNNQuery) => number[];
  nCont: number;
}

let cachePromise: Promise<KNNCache> | null = null;

export function loadKNNData(): Promise<KNNCache> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const res = await fetch("/data/projects_combined.csv");
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());
    const headers = lines[0]!.split(",");
    const allRows: Row[] = lines.slice(1).map((l) => {
      const vals = l.split(",");
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""])) as Row;
    });
    const rows = allRows.filter((r) => KNN_ORDER_COLS.some((c) => r[c] === "True"));

    const medians = KNN_CONTINUOUS.map((col) => {
      const vals = rows
        .map((r) => parseFloat(r[col] ?? ""))
        .filter((v) => !isNaN(v))
        .sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)] ?? 0;
    });

    const encode = (r: Row | KNNQuery): number[] => {
      const ht = (r as Row)["heating_existing_type"] ?? "";
      return [
        ...KNN_CONTINUOUS.map((c, i) => {
          const v = parseFloat((r as Row)[c] ?? "");
          return isNaN(v) ? medians[i]! : v;
        }),
        ...KNN_BOOLEANS.map((c) => ((r as Row)[c] === "True" ? 1.0 : 0.0)),
        (r as Row)["country"] === "Germany" ? 1.0 : 0.0,
        ht === "Gas" ? 1.0 : 0.0,
        ht === "Oil" ? 1.0 : 0.0,
        ht === "Heatpump" ? 1.0 : 0.0,
        ht ? 1.0 : 0.0,
      ];
    };

    const matrix = rows.map(encode);
    const nCont = KNN_CONTINUOUS.length;

    const means = KNN_CONTINUOUS.map(
      (_, i) => matrix.reduce((s, r) => s + r[i]!, 0) / matrix.length,
    );
    const stds = KNN_CONTINUOUS.map((_, i) => {
      const v = matrix.reduce((s, r) => s + (r[i]! - means[i]!) ** 2, 0) / matrix.length;
      return Math.sqrt(v) || 1;
    });

    const scaled = matrix.map((r) =>
      r.map((v, i) => (i < nCont ? (v - means[i]!) / stds[i]! : v)),
    );

    return { rows, scaled, medians, means, stds, encode, nCont };
  })();
  return cachePromise;
}

export interface Neighbor {
  dist: number;
  row: Row;
}

export function knnFindNearest(query: KNNQuery, cache: KNNCache, k = 10): Neighbor[] {
  const { rows, scaled, means, stds, encode, nCont } = cache;
  const raw = encode(query);
  const qVec = raw.map((v, i) => (i < nCont ? (v - means[i]!) / stds[i]! : v));
  return rows
    .map((row, idx) => ({
      dist: Math.sqrt(scaled[idx]!.reduce((s, v, i) => s + (v - qVec[i]!) ** 2, 0)),
      row,
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k);
}

export type HpClass = "yes" | "no" | "ask";
export interface HeatpumpRec {
  cls: HpClass;
  symbol: string;
  confidence: string;
  reason: string;
}

export function heatpumpRecommendation(heatingType: string): HeatpumpRec {
  if (FOSSIL_FUELS.has(heatingType)) {
    return {
      cls: "yes",
      symbol: "✅",
      confidence: "high confidence",
      reason: `Current ${heatingType} heating — fossil fuel systems are strong heat-pump candidates. 14 of 14 buyers with a known heating type in the dataset used fossil fuels.`,
    };
  }
  if (heatingType === "Heatpump") {
    return {
      cls: "no",
      symbol: "❌",
      confidence: "high confidence",
      reason: "Already has a heat pump. No buyers in the dataset added a second unit.",
    };
  }
  return {
    cls: "ask",
    symbol: "❓",
    confidence: "low confidence",
    reason: "Heating type unknown. Ask if Gas or Oil — if so, recommend a heat pump.",
  };
}
