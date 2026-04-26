/**
 * Archetype + path bucketing for the Reonic B2C wizard.
 * Implements the "Phase 2 logic" from the design doc.
 */

import type { KNNCache, Neighbor, Row } from "./knn";
import { knnFindNearest, type KNNQuery } from "./knn";

export type HomeAge = "pre1990" | "1990to2010" | "post2010";
export type Goal = "lower_bills" | "stop_gas" | "self_sufficient";

export interface Quiz {
  homeAge: HomeAge;
  goal: Goal;
  hasEv: boolean;
  monthlyBill: number; // €
}

export type ArchetypeId = "optimizer" | "pioneer" | "autarky";

export interface Archetype {
  id: ArchetypeId;
  name: string;
  tagline: string;
  accent: "blue" | "red" | "green" | "yellow";
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  optimizer: {
    id: "optimizer",
    name: "Smart Optimizer",
    tagline: "Lowest bill, fastest payback.",
    accent: "yellow",
  },
  pioneer: {
    id: "pioneer",
    name: "Green Pioneer",
    tagline: "Stop burning gas. Electrify everything.",
    accent: "green",
  },
  autarky: {
    id: "autarky",
    name: "Autarky Builder",
    tagline: "Maximum self-sufficiency, off the grid mindset.",
    accent: "blue",
  },
};

export function pickArchetype(quiz: Quiz): Archetype {
  if (quiz.goal === "stop_gas") return ARCHETYPES.pioneer;
  if (quiz.goal === "self_sufficient") return ARCHETYPES.autarky;
  return ARCHETYPES.optimizer;
}

export type StepKind = "efficiency" | "solar" | "wallbox" | "heatpump";

export interface RoadmapStep {
  kind: StepKind;
  label: string;
  title: string;
  bridge: string; // why this enables the next
  popular: boolean;
}

/**
 * Build the 3-step (or 4-step with EV) sequence based on home age + goal.
 * Bridge text follows the "Bridge Text" rule from the design checklist.
 */
export function buildRoadmap(quiz: Quiz, archetype: Archetype): RoadmapStep[] {
  const startWithEfficiency = quiz.homeAge === "pre1990";
  const wantsHeatPump = quiz.goal === "stop_gas" || archetype.id !== "optimizer";

  const steps: RoadmapStep[] = [];

  if (startWithEfficiency) {
    steps.push({
      kind: "efficiency",
      label: "The Foundation",
      title: "Insulation & loft check",
      bridge:
        "Older homes leak heat. Sealing the envelope first means a smaller, quieter heat pump in step 3 — and saves around €4k on hardware.",
      popular: true,
    });
  }

  steps.push({
    kind: "solar",
    label: "The Power",
    title: "Solar + Storage",
    bridge: quiz.hasEv
      ? "We sized a 10 kWh battery so your panels keep charging the EV after sundown."
      : "A right-sized battery lifts self-consumption from ~35% to ~65% of what your roof produces.",
    popular: true,
  });

  if (quiz.hasEv) {
    steps.push({
      kind: "wallbox",
      label: "The Charger",
      title: "11 kW Wallbox",
      bridge:
        "A smart wallbox prefers solar-first charging — every kWh from your roof beats grid power on cost and CO₂.",
      popular: true,
    });
  }

  if (wantsHeatPump) {
    steps.push({
      kind: "heatpump",
      label: "The Switch",
      title: "Heat pump",
      bridge: startWithEfficiency
        ? "With insulation done and solar live, your heat pump runs on cheap own-electricity — closing the gas chapter for good."
        : "Your solar covers most heat-pump demand in shoulder seasons. The grid carries the rest at winter peak.",
      popular: archetype.id !== "optimizer",
    });
  }

  return steps;
}

/**
 * Returns the % of nearest neighbors that ordered the same Solar+Battery combo.
 * Used for the "72% of neighbors followed this path" social proof line.
 */
export function neighborPathPercent(neighbors: Neighbor[]): number {
  if (!neighbors.length) return 0;
  const matched = neighbors.filter(
    (n) => n.row.ordered_solar === "True" && n.row.ordered_battery === "True",
  ).length;
  return Math.round((matched / neighbors.length) * 100);
}

export function buildKnnQuery(quiz: Quiz, demandKwh: number): KNNQuery {
  // Convert monthly bill → annual demand if we want to override
  // For now we trust the explicit demand input; bill calibrates ROI in UI.
  return {
    energy_demand_wh: String(demandKwh * 1000),
    energy_price_per_wh: "0.00032",
    energy_price_increase: "0.03",
    has_ev: quiz.hasEv ? "True" : "False",
    has_solar: "False",
    has_storage: "False",
    has_wallbox: "False",
    country: "Germany",
    heating_existing_type: quiz.goal === "stop_gas" ? "Gas" : "",
  };
}

export function findNeighborsFor(
  quiz: Quiz,
  demandKwh: number,
  cache: KNNCache,
  k = 10,
): Neighbor[] {
  return knnFindNearest(buildKnnQuery(quiz, demandKwh), cache, k);
}

/** Roughly translate a monthly € bill into kWh/year at €0.35/kWh */
export function billToAnnualKwh(monthlyBill: number): number {
  return Math.round(((monthlyBill * 12) / 0.35) / 100) * 100;
}

export type RowList = Row[];
