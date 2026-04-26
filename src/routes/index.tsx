import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sun, Battery, Zap, Loader2, KeyRound, MapPin, TrendingUp } from "lucide-react";

import { RoofMap } from "@/components/RoofMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import {
  azimuthToDir,
  fetchSolar,
  fetchSuggestions,
  geocode,
  generateOffer,
  recommendSystem,
  SERVICE_TYPES,
  type RoofSegment,
  type Recommendation,
  type OfferItem,
  type Suggestion,
} from "@/lib/solar";
import {
  heatpumpRecommendation,
  KNN_ORDER_COLS,
  KNN_ORDER_LABELS,
  knnFindNearest,
  loadKNNData,
  type KNNQuery,
  type Neighbor,
} from "@/lib/knn";

export const Route = createFileRoute("/")({
  component: RoofAnalyzer,
});

const API_KEY_STORAGE = "reonic.maps_api_key";

interface AnalysisResult {
  address: string;
  lat: number;
  lon: number;
  totalArea: number;
  sunshine: number;
  segments: RoofSegment[];
  rec: Recommendation;
  offer: OfferItem[];
  demandKwh: number;
  neighbors: Neighbor[];
  query: KNNQuery;
}

function RoofAnalyzer() {
  // Inputs
  const [apiKey, setApiKey] = useState("");
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [address, setAddress] = useState("");
  const [demand, setDemand] = useState("4500");
  const [heating, setHeating] = useState<string>("");
  const [hasEv, setHasEv] = useState(false);

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Result
  const [status, setStatus] = useState<string>("Enter an address to analyze its solar potential.");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // Hydrate API key from localStorage (client only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(API_KEY_STORAGE) ?? "";
    setApiKey(saved);
    if (!saved) setShowKeyEditor(true);
  }, []);

  function saveApiKey(key: string) {
    setApiKey(key);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(API_KEY_STORAGE, key);
    }
  }

  // Address autocomplete
  function onAddressChange(v: string) {
    setAddress(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 3) {
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchSuggestions(v.trim());
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch {
        setShowSuggestions(false);
      }
    }, 300);
  }

  function pickSuggestion(s: Suggestion) {
    setAddress(s.display_name.split(",").slice(0, 3).join(", "));
    setShowSuggestions(false);
    void analyze(s.display_name);
  }

  async function analyze(forcedAddress?: string) {
    const q = (forcedAddress ?? address).trim();
    if (!q) {
      setStatus("Please enter an address.");
      return;
    }
    if (!apiKey) {
      setStatus("A Google Maps API key is required to call the Solar API.");
      setShowKeyEditor(true);
      return;
    }
    const demandKwh = parseFloat(demand) || 4500;
    setLoading(true);
    setResult(null);
    setStatus("Geocoding address…");
    try {
      const geo = await geocode(q);
      if (!geo) {
        setStatus("Address not found. Try a more specific query.");
        setLoading(false);
        return;
      }

      setStatus("Fetching solar data from Google…");
      let solar = await fetchSolar(geo.lat, geo.lon, apiKey, "HIGH");
      if (solar.error) solar = await fetchSolar(geo.lat, geo.lon, apiKey, "MEDIUM");
      if (solar.error || !solar.solarPotential) {
        setStatus(
          solar.error?.message
            ? `Solar API error: ${solar.error.message}`
            : "No solar data available for this location.",
        );
        setLoading(false);
        return;
      }

      const sp = solar.solarPotential;
      const segments = sp.roofSegmentStats ?? [];
      const sorted = [...segments].sort((a, b) => b.stats.areaMeters2 - a.stats.areaMeters2);
      const rec = recommendSystem(
        demandKwh,
        sp.maxArrayPanelsCount ?? 0,
        sp.maxSunshineHoursPerYear ?? 0,
        sorted,
      );
      const offer = generateOffer(rec);

      const query: KNNQuery = {
        energy_demand_wh: String(demandKwh * 1000),
        energy_price_per_wh: "0.00032",
        energy_price_increase: "0.03",
        has_ev: hasEv ? "True" : "False",
        has_solar: "False",
        has_storage: "False",
        has_wallbox: "False",
        country: "Germany",
        heating_existing_type: heating,
      };

      let neighbors: Neighbor[] = [];
      try {
        const cache = await loadKNNData();
        neighbors = knnFindNearest(query, cache, 10);
      } catch (e) {
        console.warn("KNN load failed", e);
      }

      setResult({
        address: geo.display_name,
        lat: geo.lat,
        lon: geo.lon,
        totalArea: sp.wholeRoofStats?.areaMeters2 ?? 0,
        sunshine: sp.maxSunshineHoursPerYear ?? 0,
        segments: sorted,
        rec,
        offer,
        demandKwh,
        neighbors,
        query,
      });
      setStatus(`✓ Analysis complete for ${geo.display_name.split(",").slice(0, 2).join(",")}`);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex h-full w-[380px] min-w-[380px] flex-col border-r border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--reonic-blue)]">
            <Sun className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold leading-tight">Reonic Roof Analyzer</h1>
            <p className="text-xs text-muted-foreground">AI-powered solar proposal</p>
          </div>
          <button
            type="button"
            onClick={() => setShowKeyEditor((s) => !s)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="API key settings"
            title="API key settings"
          >
            <KeyRound className="h-4 w-4" />
          </button>
        </header>

        <ScrollArea className="flex-1">
          <div className="space-y-4 px-5 py-5">
            {showKeyEditor && (
              <ApiKeyEditor apiKey={apiKey} onSave={saveApiKey} onClose={() => setShowKeyEditor(false)} />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <div className="relative">
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => onAddressChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setShowSuggestions(false);
                      void analyze();
                    }
                  }}
                  placeholder="e.g. Charité Berlin, BER Airport…"
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                    {suggestions.map((s, i) => (
                      <button
                        type="button"
                        key={`${s.lat}-${s.lon}-${i}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickSuggestion(s);
                        }}
                        className="flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                      >
                        <span className="text-foreground">
                          {s.display_name.split(",").slice(0, 3).join(", ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {s.type} ·{" "}
                          {s.display_name.split(",").slice(-2).join(",").trim()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="demand">Annual energy demand (kWh)</Label>
              <Input
                id="demand"
                type="number"
                value={demand}
                onChange={(e) => setDemand(e.target.value)}
                placeholder="4500"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="heating">Current heating system</Label>
              <Select value={heating || "unknown"} onValueChange={(v) => setHeating(v === "unknown" ? "" : v)}>
                <SelectTrigger id="heating">
                  <SelectValue placeholder="Unknown" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="Gas">Gas</SelectItem>
                  <SelectItem value="Oil">Oil</SelectItem>
                  <SelectItem value="Heatpump">Heat pump (existing)</SelectItem>
                  <SelectItem value="OtherNonRenewable">Other (non-renewable)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={hasEv}
                onCheckedChange={(v) => setHasEv(v === true)}
                id="ev"
              />
              <span>Has electric vehicle (EV)</span>
            </label>

            <Button
              onClick={() => void analyze()}
              disabled={loading}
              className="w-full bg-[var(--reonic-blue)] text-white hover:bg-[var(--reonic-blue)]/90"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Analyze roof &amp; generate offer
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground">{status}</p>

            {result && <ResultsPanel result={result} />}
          </div>
        </ScrollArea>

        <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          Powered by Google Solar API + Reonic project data
        </footer>
      </aside>

      {/* Map */}
      <main className="relative flex-1">
        <RoofMap
          lat={result?.lat ?? null}
          lon={result?.lon ?? null}
          segments={result?.segments ?? null}
        />
        {!result && !loading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="pointer-events-auto rounded-xl border border-border bg-card/95 px-6 py-5 text-center shadow-lg backdrop-blur">
              <MapPin className="mx-auto mb-2 h-6 w-6 text-[var(--reonic-blue)]" />
              <p className="text-sm font-medium">Enter an address to begin</p>
              <p className="mt-1 text-xs text-muted-foreground">
                We&apos;ll analyze the roof &amp; recommend a system
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── API Key editor ─────────────────────────────────────────────────────────
function ApiKeyEditor({
  apiKey,
  onSave,
  onClose,
}: {
  apiKey: string;
  onSave: (k: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(apiKey);
  return (
    <Card className="space-y-2 border-[var(--reonic-yellow)]/60 bg-[var(--reonic-yellow)]/15 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="h-4 w-4" />
        Google Maps API key
      </div>
      <p className="text-xs text-muted-foreground">
        Needs the Solar API enabled. Stored locally in your browser only.
      </p>
      <Input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="AIza…"
        className="bg-background"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            onSave(value.trim());
            onClose();
          }}
          className="bg-[var(--reonic-blue)] text-white hover:bg-[var(--reonic-blue)]/90"
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ─── Results ────────────────────────────────────────────────────────────────
function ResultsPanel({ result }: { result: AnalysisResult }) {
  const { rec, demandKwh, totalArea, sunshine, segments, offer, neighbors, query } = result;
  const coverage = Math.min(100, Math.round((rec.recProduction / Math.max(demandKwh, 1)) * 100));

  const components = offer.filter((i) => !SERVICE_TYPES.has(i.type));
  const services = offer.filter((i) => SERVICE_TYPES.has(i.type));

  return (
    <div className="space-y-4">
      <Separator />

      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Roof</span>
          <span className="text-xs text-muted-foreground">{sunshine.toFixed(0)} h sun/yr</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Total area" value={`${totalArea.toFixed(0)} m²`} />
          <Stat
            label="Usable for solar"
            value={`${rec.usableArea.toFixed(0)} m²`}
            accent="green"
          />
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Recommended system
          </span>
          <Badge tone={coverage >= 100 ? "green" : coverage >= 70 ? "yellow" : "red"}>
            {coverage}% of demand
          </Badge>
        </div>
        <Progress value={coverage} className="h-1.5" />
        <div className="grid gap-2">
          <SystemRow
            icon={<Sun className="h-4 w-4" />}
            label={`${rec.recPanels} panels × 475 W`}
            value={`${rec.recKwp.toFixed(1)} kWp`}
            tone="blue"
          />
          <SystemRow
            icon={<Battery className="h-4 w-4" />}
            label="Battery storage"
            value={`${rec.batteryKwh} kWh`}
            tone="green"
          />
          <SystemRow
            icon={<Zap className="h-4 w-4" />}
            label="Hybrid inverter"
            value={`${rec.inverterKw} kW`}
            tone="yellow"
          />
        </div>
        {rec.targetPanels > rec.maxUsablePanels && (
          <p className="rounded-md bg-[var(--reonic-red)]/10 px-2 py-1.5 text-xs text-[var(--reonic-red)]">
            Roof fits {rec.maxUsablePanels} panels, but {rec.targetPanels} would be needed for 100%
            coverage.
          </p>
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[var(--reonic-blue)]" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Financials
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="System cost" value={`€${(rec.systemCost / 1000).toFixed(1)}k`} />
          <Stat
            label="Annual savings"
            value={`€${rec.annualSavings.toFixed(0)}`}
            accent="green"
          />
          <Stat
            label="Payback"
            value={
              isFinite(rec.paybackYears) ? `${rec.paybackYears.toFixed(1)} yrs` : "—"
            }
            accent="blue"
          />
          <Stat
            label="20-year profit"
            value={`€${(rec.roi20y / 1000).toFixed(1)}k`}
            accent="green"
          />
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Roof segments
        </span>
        <div className="space-y-1">
          {segments.slice(0, 6).map((seg, i) => {
            const dir = azimuthToDir(seg.azimuthDegrees);
            const unusable = seg.pitchDegrees > 45 || (dir === "N" && seg.pitchDegrees > 15);
            return (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: unusable
                    ? "var(--muted-foreground)"
                    : ["#4A5685", "#BCDA8A", "#F2D473", "#EF5446"][i % 4],
                  opacity: unusable ? 0.55 : 1,
                }}
              >
                <span>
                  #{i + 1}: {seg.stats.areaMeters2.toFixed(0)} m² · {dir} ·{" "}
                  {seg.pitchDegrees.toFixed(0)}° tilt
                </span>
                <span className={unusable ? "text-muted-foreground" : "text-[var(--reonic-blue)]"}>
                  {unusable ? "skip" : "ok"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Offer components
        </span>
        <div className="space-y-1">
          {components.map((item, i) => (
            <OfferRow key={i} item={item} />
          ))}
        </div>
        <details className="group mt-1">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
            <span className="inline-block transition-transform group-open:rotate-90">▶</span>{" "}
            Installation &amp; services
          </summary>
          <div className="mt-2 space-y-1">
            {services.map((item, i) => (
              <OfferRow key={i} item={item} />
            ))}
          </div>
        </details>
      </Card>

      <NeighborsPanel neighbors={neighbors} query={query} />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "blue" | "green" | "yellow" | "red";
}) {
  const accentColor = useMemo(() => {
    if (accent === "blue") return "var(--reonic-blue)";
    if (accent === "green") return "oklch(0.5 0.15 145)";
    if (accent === "yellow") return "oklch(0.55 0.13 80)";
    if (accent === "red") return "var(--reonic-red)";
    return "var(--foreground)";
  }, [accent]);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold" style={{ color: accentColor }}>
        {value}
      </div>
    </div>
  );
}

function SystemRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "blue" | "green" | "yellow";
}) {
  const bg =
    tone === "blue"
      ? "var(--reonic-blue)"
      : tone === "green"
        ? "var(--reonic-green)"
        : "var(--reonic-yellow)";
  const fg = tone === "blue" ? "#fff" : "oklch(0.2 0 0)";
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-sm">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: bg, color: fg }}
      >
        {icon}
      </div>
      <span className="flex-1 truncate text-foreground">{label}</span>
      <span className="font-mono text-xs font-semibold">{value}</span>
    </div>
  );
}

function OfferRow({ item }: { item: OfferItem }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="font-mono text-muted-foreground">{item.qty}×</span>
      <span className="flex-1">{item.name}</span>
      {item.brand && <span className="text-muted-foreground">{item.brand}</span>}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "yellow" | "red" | "blue" }) {
  const map: Record<string, { bg: string; fg: string }> = {
    green: { bg: "var(--reonic-green)", fg: "oklch(0.25 0.05 145)" },
    yellow: { bg: "var(--reonic-yellow)", fg: "oklch(0.3 0.06 80)" },
    red: { bg: "var(--reonic-red)", fg: "#fff" },
    blue: { bg: "var(--reonic-blue)", fg: "#fff" },
  };
  const { bg, fg } = map[tone]!;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: bg, color: fg }}
    >
      {children}
    </span>
  );
}

function NeighborsPanel({ neighbors, query }: { neighbors: Neighbor[]; query: KNNQuery }) {
  if (!neighbors.length) return null;
  const probs = KNN_ORDER_COLS.map((comp, i) => ({
    label: KNN_ORDER_LABELS[i],
    prob: neighbors.filter((n) => n.row[comp] === "True").length / neighbors.length,
  }));
  const hp = heatpumpRecommendation(query.heating_existing_type);

  const top = neighbors.slice(0, 3);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Similar households
        </span>
        <p className="text-[11px] text-muted-foreground">{neighbors.length} matches in dataset</p>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Component likelihood
        </div>
        {probs.map(({ label, prob }) => {
          const pct = Math.round(prob * 100);
          const tone = prob >= 0.7 ? "green" : prob >= 0.4 ? "yellow" : "red";
          const fillColor =
            tone === "green"
              ? "var(--reonic-green)"
              : tone === "yellow"
                ? "var(--reonic-yellow)"
                : "var(--muted-foreground)";
          return (
            <div key={label} className="grid grid-cols-[80px_1fr_36px] items-center gap-2 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: fillColor }}
                />
              </div>
              <span className="text-right font-mono">{pct}%</span>
            </div>
          );
        })}
      </div>

      <div
        className="rounded-md border-l-[3px] px-3 py-2 text-xs leading-relaxed"
        style={{
          borderLeftColor:
            hp.cls === "yes"
              ? "var(--reonic-green)"
              : hp.cls === "no"
                ? "var(--muted-foreground)"
                : "var(--reonic-yellow)",
          backgroundColor:
            hp.cls === "yes"
              ? "color-mix(in oklab, var(--reonic-green) 25%, transparent)"
              : hp.cls === "ask"
                ? "color-mix(in oklab, var(--reonic-yellow) 20%, transparent)"
                : "var(--muted)",
        }}
      >
        <strong className="block">
          {hp.symbol} Heat pump — {hp.confidence}
        </strong>
        <span className="text-muted-foreground">{hp.reason}</span>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Closest projects
        </div>
        {top.map(({ row }, i) => {
          const tags: string[] = [];
          if (row.ordered_solar === "True")
            tags.push(`☀️ ${row.primary_module_count || "?"} panels`);
          if (row.ordered_battery === "True")
            tags.push(`🔋 ${row.primary_battery_kwh || "?"} kWh`);
          if (row.ordered_wallbox === "True")
            tags.push(`🔌 ${row.primary_wallbox_kw || "?"} kW`);
          if (row.ordered_heatpump === "True") tags.push("♨️ heat pump");
          const demand = row.energy_demand_wh
            ? `${(parseFloat(row.energy_demand_wh) / 1000).toFixed(0)} kWh`
            : "—";
          const ht = row.heating_existing_type || "?";
          const ev = row.has_ev === "True" ? " · EV" : "";
          return (
            <div key={i} className="rounded-md bg-muted px-2.5 py-1.5 text-[11px] leading-snug">
              <div className="font-medium">
                {demand} · {ht}
                {ev}
              </div>
              <div className="text-muted-foreground">{tags.join(" · ") || "—"}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
