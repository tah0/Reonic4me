import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Battery,
  Check,
  Download,
  Flame,
  Home,
  KeyRound,
  Leaf,
  Loader2,
  MapPin,
  Plug,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  Wind,
} from "lucide-react";

import reonicLogo from "@/assets/reonic-logo.png";
import { RoofMap } from "@/components/RoofMap";
import { WeatherBadge } from "@/components/WeatherBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

import {
  fetchSolar,
  fetchSuggestions,
  geocode,
  recommendSystem,
  type RoofSegment,
  type Recommendation,
  type Suggestion,
} from "@/lib/solar";
import { loadKNNData, type Neighbor } from "@/lib/knn";
import {
  ARCHETYPES,
  billToAnnualKwh,
  buildRoadmap,
  findNeighborsFor,
  neighborPathPercent,
  pickArchetype,
  type Archetype,
  type Goal,
  type HomeAge,
  type Quiz,
  type RoadmapStep,
} from "@/lib/archetype";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reonic4me — Your home, your energy path" },
      {
        name: "description",
        content:
          "See your roof in 3D, get a personalized solar + heat-pump roadmap, and download an installer brief in minutes.",
      },
      { property: "og:title", content: "Reonic4me — Your home, your energy path" },
      {
        property: "og:description",
        content:
          "Personalized solar, storage and heat-pump roadmap based on your roof and 300+ real Reonic installations.",
      },
    ],
  }),
  component: ReonicWizard,
});

const API_KEY_STORAGE = "reonic.maps_api_key";

type Phase = 1 | 2 | 3 | 4 | 5;

interface DiscoveryResult {
  address: string;
  lat: number;
  lon: number;
  totalArea: number;
  sunshine: number;
  segments: RoofSegment[];
  rec: Recommendation;
}

function ReonicWizard() {
  const [phase, setPhase] = useState<Phase>(1);

  // Phase 1
  const [apiKey, setApiKey] = useState("");
  const [showKeyEditor, setShowKeyEditor] = useState(false);
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSug, setShowSug] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);

  // Phase 2 — quiz
  const [quiz, setQuiz] = useState<Quiz>({
    homeAge: "1990to2010",
    goal: "lower_bills",
    hasEv: false,
    monthlyBill: 130,
  });

  // Phase 3 — neighbors
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);

  // Hydrate API key
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(API_KEY_STORAGE) ?? "";
    setApiKey(saved);
    if (!saved) setShowKeyEditor(true);
  }, []);

  function saveApiKey(k: string) {
    setApiKey(k);
    if (typeof window !== "undefined") window.localStorage.setItem(API_KEY_STORAGE, k);
  }

  function onAddressChange(v: string) {
    setAddress(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 3) {
      setShowSug(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchSuggestions(v.trim());
        setSuggestions(data);
        setShowSug(data.length > 0);
      } catch {
        setShowSug(false);
      }
    }, 300);
  }

  async function runDiscovery(forced?: string) {
    const q = (forced ?? address).trim();
    if (!q) return setError("Please enter an address.");
    if (!apiKey) {
      setError("A Google Maps API key is required.");
      setShowKeyEditor(true);
      return;
    }
    setLoading(true);
    setError(null);
    setShowSug(false);
    try {
      const geo = await geocode(q);
      if (!geo) {
        setError("Address not found. Try a more specific query.");
        return;
      }
      let solar = await fetchSolar(geo.lat, geo.lon, apiKey, "HIGH");
      if (solar.error) solar = await fetchSolar(geo.lat, geo.lon, apiKey, "MEDIUM");
      if (solar.error || !solar.solarPotential) {
        setError(solar.error?.message ?? "No solar data available for this address.");
        return;
      }
      const sp = solar.solarPotential;
      const segs = [...(sp.roofSegmentStats ?? [])].sort(
        (a, b) => b.stats.areaMeters2 - a.stats.areaMeters2,
      );
      // Use a baseline 4500 kWh demand for the hook number; refined in phase 2.
      const rec = recommendSystem(
        4500,
        sp.maxArrayPanelsCount ?? 0,
        sp.maxSunshineHoursPerYear ?? 0,
        segs,
      );
      setDiscovery({
        address: geo.display_name,
        lat: geo.lat,
        lon: geo.lon,
        totalArea: sp.wholeRoofStats?.areaMeters2 ?? 0,
        sunshine: sp.maxSunshineHoursPerYear ?? 0,
        segments: segs,
        rec,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Re-recommend with quiz-aware demand once user reaches phase 3+
  const refinedRec = useMemo<Recommendation | null>(() => {
    if (!discovery) return null;
    const demand = billToAnnualKwh(quiz.monthlyBill);
    return recommendSystem(
      demand,
      Math.round(discovery.rec.maxPanels),
      discovery.sunshine,
      discovery.segments,
    );
  }, [discovery, quiz.monthlyBill]);

  const archetype: Archetype = useMemo(() => pickArchetype(quiz), [quiz]);
  const roadmap: RoadmapStep[] = useMemo(
    () => buildRoadmap(quiz, archetype),
    [quiz, archetype],
  );
  const neighborPct = useMemo(() => neighborPathPercent(neighbors), [neighbors]);

  async function goToPhase3() {
    if (!discovery) return;
    setPhase(3);
    try {
      const cache = await loadKNNData();
      const nb = findNeighborsFor(quiz, billToAnnualKwh(quiz.monthlyBill), cache, 12);
      setNeighbors(nb);
    } catch (e) {
      console.warn("KNN load failed", e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        phase={phase}
        archetype={phase >= 3 ? archetype : null}
        savings={phase >= 3 && refinedRec ? refinedRec.annualSavings : null}
        onOpenKey={() => setShowKeyEditor(true)}
      />
      <WeatherBadge location={discovery?.address ?? null} />

      <main className="flex-1 overflow-y-auto">
        {phase === 1 && (
          <PhaseDiscovery
            address={address}
            onAddressChange={onAddressChange}
            suggestions={suggestions}
            showSug={showSug}
            onPick={(s) => {
              setAddress(s.display_name.split(",").slice(0, 3).join(", "));
              setShowSug(false);
              void runDiscovery(s.display_name);
            }}
            onAnalyze={() => void runDiscovery()}
            loading={loading}
            error={error}
            discovery={discovery}
            onContinue={() => setPhase(2)}
          />
        )}

        {phase === 2 && discovery && (
          <PhaseLogic
            quiz={quiz}
            setQuiz={setQuiz}
            onBack={() => setPhase(1)}
            onContinue={() => void goToPhase3()}
          />
        )}

        {phase === 3 && discovery && refinedRec && (
          <PhaseAlignment
            archetype={archetype}
            quiz={quiz}
            rec={refinedRec}
            neighborPct={neighborPct}
            neighborCount={neighbors.length}
            onBack={() => setPhase(2)}
            onContinue={() => setPhase(4)}
          />
        )}

        {phase === 4 && discovery && refinedRec && (
          <PhaseRoadmap
            roadmap={roadmap}
            archetype={archetype}
            rec={refinedRec}
            discovery={discovery}
            onBack={() => setPhase(3)}
            onContinue={() => setPhase(5)}
          />
        )}

        {phase === 5 && discovery && refinedRec && (
          <PhaseAction
            quiz={quiz}
            archetype={archetype}
            roadmap={roadmap}
            rec={refinedRec}
            discovery={discovery}
            onBack={() => setPhase(4)}
            onRestart={() => {
              setPhase(1);
              setDiscovery(null);
              setNeighbors([]);
              setAddress("");
            }}
          />
        )}
      </main>

      {showKeyEditor && (
        <ApiKeyEditor
          initial={apiKey}
          onSave={(k) => {
            saveApiKey(k);
            setShowKeyEditor(false);
          }}
          onClose={() => setShowKeyEditor(false)}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Top bar
 * ────────────────────────────────────────────────────────────────────────── */
function TopBar({
  phase,
  archetype,
  savings,
  onOpenKey,
}: {
  phase: Phase;
  archetype: Archetype | null;
  savings: number | null;
  onOpenKey: () => void;
}) {
  const labels = ["Discovery", "Profile", "Path", "Roadmap", "Brief"];
  return (
    <header className="flex items-center gap-6 border-b border-border bg-card px-6 py-3">
      <a href="/" className="flex items-center" aria-label="Reonic4me — home">
        <img
          src={reonicLogo}
          alt="Reonic4me"
          className="h-9 w-auto"
        />
      </a>

      <ol className="hidden flex-1 items-center gap-2 md:flex">
        {labels.map((l, i) => {
          const n = (i + 1) as Phase;
          const active = n === phase;
          const done = n < phase;
          return (
            <li key={l} className="flex items-center gap-2">
              <div
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  done
                    ? "bg-[var(--reonic-green)] text-foreground"
                    : active
                      ? "bg-[var(--reonic-blue)] text-white"
                      : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              <span
                className={[
                  "text-xs",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                {l}
              </span>
              {i < labels.length - 1 && (
                <span className="mx-1 h-px w-6 bg-border" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <div className="ml-auto flex items-center gap-3">
        {archetype && savings != null && (
          <div className="hidden items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 sm:flex">
            <TrendingUp className="h-4 w-4 text-[var(--reonic-blue)]" />
            <span className="text-xs text-muted-foreground">Projected savings</span>
            <span className="text-sm font-semibold tabular-nums">
              €{Math.round(savings).toLocaleString()}/yr
            </span>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={onOpenKey} className="gap-2">
          <KeyRound className="h-4 w-4" />
          API key
        </Button>
      </div>
    </header>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Phase 1 — Discovery
 * ────────────────────────────────────────────────────────────────────────── */
function PhaseDiscovery({
  address,
  onAddressChange,
  suggestions,
  showSug,
  onPick,
  onAnalyze,
  loading,
  error,
  discovery,
  onContinue,
}: {
  address: string;
  onAddressChange: (v: string) => void;
  suggestions: Suggestion[];
  showSug: boolean;
  onPick: (s: Suggestion) => void;
  onAnalyze: () => void;
  loading: boolean;
  error: string | null;
  discovery: DiscoveryResult | null;
  onContinue: () => void;
}) {
  return (
    <section className="mx-auto grid h-full max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-2">
      <div className="flex flex-col justify-center">
        <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--reonic-green)_50%,white)] px-3 py-1 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Discovery
        </span>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          See what your roof can do.
        </h1>
        <p className="mt-4 max-w-md text-base text-muted-foreground">
          Enter your address, and we’ll use a 3D scan to show you exactly how much power your home can generate.
        </p>

        <div className="relative mt-8 max-w-md">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Your home address
          </Label>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={address}
                onChange={(e) => onAddressChange(e.target.value)}
                placeholder="e.g. Unter den Linden 1, Berlin"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && onAnalyze()}
              />
              {showSug && (
                <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow">
                  {suggestions.map((s, i) => (
                    <li key={`${s.lat}-${s.lon}-${i}`}>
                      <button
                        type="button"
                        onClick={() => onPick(s)}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {s.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button onClick={onAnalyze} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sun className="h-4 w-4" />}
              Scan
            </Button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-[var(--reonic-red)]">{error}</p>
          )}
        </div>

        {discovery && (
          <Card className="mt-8 max-w-md border-[var(--reonic-blue)]/40 bg-[color-mix(in_oklab,var(--reonic-blue)_8%,white)] p-5">
            <p className="text-sm text-muted-foreground">We&apos;ve analyzed your roof.</p>
            <p className="mt-2 text-2xl font-semibold leading-snug">
              You have space for{" "}
              <span className="text-[var(--reonic-blue)]">
                {discovery.rec.maxUsablePanels} panels
              </span>
              , which could save you{" "}
              <span className="text-[var(--reonic-blue)]">
                €{Math.round(discovery.rec.annualSavings).toLocaleString()}
              </span>{" "}
              every year.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Let&apos;s find your best path to claim those savings.
            </p>
            <Button onClick={onContinue} className="mt-5 gap-2">
              Find my path
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Card>
        )}
      </div>

      <div className="relative min-h-[420px] overflow-hidden rounded-xl border border-border bg-muted">
        {discovery ? (
          <RoofMap
            lat={discovery.lat}
            lon={discovery.lon}
            segments={discovery.rec.usableSegments}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            <div>
              <Home className="mx-auto mb-3 h-10 w-10 opacity-40" />
              Your roof will appear here.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Phase 2 — Logic (quiz)
 * ────────────────────────────────────────────────────────────────────────── */
function PhaseLogic({
  quiz,
  setQuiz,
  onBack,
  onContinue,
}: {
  quiz: Quiz;
  setQuiz: (q: Quiz) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--reonic-yellow)_60%,white)] px-3 py-1 text-xs font-medium text-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Profile
      </span>
      <h2 className="text-3xl font-semibold tracking-tight">
        Four quick questions, one tailored path.
      </h2>
      <p className="mt-2 text-muted-foreground">
        Your answers calibrate the recommendation against 300+ real Reonic installations.
      </p>

      <div className="mt-8 space-y-6">
        <QuestionGroup
          n={1}
          title="When was your home built?"
          why="Older homes usually lose more heat. Knowing the age helps us decide if we should fix leaks first, to save system power later."
        >
          <ChoiceGrid
            value={quiz.homeAge}
            onChange={(v) => setQuiz({ ...quiz, homeAge: v as HomeAge })}
            options={[
              { v: "pre1990", label: "Before 1990", sub: "" },
              { v: "1990to2010", label: "1990 – 2010", sub: "" },
              { v: "post2010", label: "After 2010", sub: "" },
            ]}
          />
        </QuestionGroup>

        <QuestionGroup
          n={2}
          title="What is your main goal for this project?"
          why="Everyone's priorities are different. We'll build a path that matches your goal and considers what other people with homes like yours chose."
        >
          <ChoiceGrid
            value={quiz.goal}
            onChange={(v) => setQuiz({ ...quiz, goal: v as Goal })}
            options={[
              { v: "lower_bills", label: "Lower my bills", sub: "Fastest payback" },
              { v: "stop_gas", label: "Stop using gas or oil", sub: "Electrify heating" },
              { v: "self_sufficient", label: "Make my own power", sub: "Off-grid mindset" },
            ]}
          />
        </QuestionGroup>

        <QuestionGroup
          n={3}
          title="Do you have or plan to get an Electric Car (EV)?"
          why="Electric cars use a lot of power. If you have one, we'll make sure your batter is big enough to charge your car, with the sun."
        >
          <ChoiceGrid
            value={quiz.hasEv ? "yes" : "no"}
            onChange={(v) => setQuiz({ ...quiz, hasEv: v === "yes" })}
            options={[
              { v: "yes", label: "Yes", sub: "Adds wallbox + larger battery" },
              { v: "no", label: "No", sub: "Standard battery sizing" },
            ]}
          />
        </QuestionGroup>

        <QuestionGroup
          n={4}
          title="About how much is your monthly electric bill?"
          why="This helps us calculate your 'Payback Day' - the exact date your system will have saved you enough money to pay for itself."
        >
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">€ / month</span>
              <span className="text-2xl font-semibold tabular-nums">
                €{quiz.monthlyBill}
              </span>
            </div>
            <Slider
              value={[quiz.monthlyBill]}
              min={40}
              max={400}
              step={10}
              onValueChange={([v]) => setQuiz({ ...quiz, monthlyBill: v ?? quiz.monthlyBill })}
              className="mt-4"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              ≈ {billToAnnualKwh(quiz.monthlyBill).toLocaleString()} kWh/year at €0.35/kWh
            </p>
          </div>
        </QuestionGroup>
      </div>

      <div className="mt-10 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onContinue} className="gap-2">
          Reveal my path
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function QuestionGroup({
  n,
  title,
  why,
  children,
}: {
  n: number;
  title: string;
  why: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--reonic-blue)] text-xs font-medium text-white">
          {n}
        </span>
        <h3 className="text-lg font-medium">{title}</h3>
      </div>
      <p className="ml-9 mt-1 text-xs text-muted-foreground">{why}</p>
      <div className="ml-9 mt-3">{children}</div>
    </div>
  );
}

function ChoiceGrid<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string; sub: string }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={[
              "rounded-lg border p-4 text-left transition",
              active
                ? "border-[var(--reonic-blue)] bg-[color-mix(in_oklab,var(--reonic-blue)_10%,white)]"
                : "border-border bg-card hover:border-foreground/30",
            ].join(" ")}
          >
            <div className="text-sm font-medium">{o.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{o.sub}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Phase 3 — Alignment (archetype reveal + social proof)
 * ────────────────────────────────────────────────────────────────────────── */
function PhaseAlignment({
  archetype,
  quiz,
  rec,
  neighborPct,
  neighborCount,
  onBack,
  onContinue,
}: {
  archetype: Archetype;
  quiz: Quiz;
  rec: Recommendation;
  neighborPct: number;
  neighborCount: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const accentVar = `var(--reonic-${archetype.accent})`;
  const goalText: Record<Goal, string> = {
    lower_bills: "lower your monthly bill",
    stop_gas: "stop using gas",
    self_sufficient: "reach self-sufficiency",
  };
  const ageText: Record<HomeAge, string> = {
    pre1990: "pre-1990",
    "1990to2010": "1990s-era",
    post2010: "modern",
  };

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Path reveal
      </span>

      <Card
        className="overflow-hidden border-2 p-0"
        style={{ borderColor: accentVar }}
      >
        <div
          className="px-8 py-10"
          style={{
            background: `linear-gradient(135deg, color-mix(in oklab, ${accentVar} 18%, white), white)`,
          }}
        >
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            You are a
          </p>
          <h2
            className="mt-1 text-5xl font-semibold tracking-tight"
            style={{ color: accentVar }}
          >
            {archetype.name}
          </h2>
          <p className="mt-3 max-w-xl text-lg text-foreground/80">
            {archetype.tagline}
          </p>

          <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-background/70 px-4 py-3">
            <Users className="h-5 w-5 text-[var(--reonic-blue)]" />
            <p className="text-sm">
              Based on your {ageText[quiz.homeAge]} home and goal to{" "}
              <strong>{goalText[quiz.goal]}</strong>,{" "}
              <strong>
                {neighborPct}% of {neighborCount || "similar"} neighbors
              </strong>{" "}
              followed this 3-step sequence.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat label="Roof potential" value={`${rec.maxUsablePanels} panels`} />
          <Stat label="Annual savings" value={`€${Math.round(rec.annualSavings).toLocaleString()}`} />
          <Stat
            label="Payback"
            value={
              isFinite(rec.paybackYears) ? `${rec.paybackYears.toFixed(1)} yrs` : "—"
            }
          />
        </div>
      </Card>

      <div className="mt-10 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Tweak answers
        </Button>
        <Button onClick={onContinue} className="gap-2">
          See my roadmap
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-6 py-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Phase 4 — Roadmap (vertical timeline)
 * ────────────────────────────────────────────────────────────────────────── */
const STEP_ICONS = {
  efficiency: Wind,
  solar: Sun,
  wallbox: Plug,
  heatpump: Flame,
} as const;

function PhaseRoadmap({
  roadmap,
  archetype,
  rec,
  discovery,
  onBack,
  onContinue,
}: {
  roadmap: RoadmapStep[];
  archetype: Archetype;
  rec: Recommendation;
  discovery: DiscoveryResult;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Roadmap
      </span>
      <h2 className="text-3xl font-semibold tracking-tight">
        Your {roadmap.length}-step path to a future-proof home
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Each step unlocks the next, so you're getting the hardware you need.
      </p>

      <ol className="mt-10 space-y-6">
        {roadmap.map((step, i) => {
          const Icon = STEP_ICONS[step.kind];
          const isLast = i === roadmap.length - 1;
          return (
            <li key={step.kind} className="relative">
              {!isLast && (
                <span
                  className="absolute left-7 top-16 h-[calc(100%-2rem)] w-px bg-border"
                  aria-hidden
                />
              )}
              <div className="flex gap-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--reonic-blue)] text-white">
                  <Icon className="h-6 w-6" />
                </div>
                <Card className="flex-1 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Step {i + 1} · {step.label}
                    </span>
                    {step.popular && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--reonic-green)] px-2 py-0.5 text-xs font-medium text-foreground">
                        <Leaf className="h-3 w-3" />
                        Popular Choice
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-foreground/80">{step.bridge}</p>

                  {step.kind === "solar" && (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Mini icon={Sun} label="Panels" value={`${rec.recPanels}`} />
                      <Mini icon={Sun} label="System" value={`${rec.recKwp.toFixed(1)} kWp`} />
                      <Mini icon={Battery} label="Battery" value={`${rec.batteryKwh} kWh`} />
                      <Mini
                        icon={TrendingUp}
                        label="Savings/yr"
                        value={`€${Math.round(rec.annualSavings).toLocaleString()}`}
                      />
                    </div>
                  )}
                  {step.kind === "efficiency" && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Mini icon={Home} label="Roof area" value={`${Math.round(discovery.totalArea)} m²`} />
                      <Mini icon={Wind} label="Est. heat saving" value="20–30%" />
                    </div>
                  )}
                  {step.kind === "heatpump" && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Mini icon={Flame} label="HP size" value="5–9 kW" />
                      <Mini icon={Plug} label="Runs on" value="Own solar" />
                    </div>
                  )}
                  {step.kind === "wallbox" && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Mini icon={Plug} label="Power" value="11 kW" />
                      <Mini icon={Sun} label="Mode" value="Solar-first" />
                    </div>
                  )}
                </Card>
              </div>
            </li>
          );
        })}
      </ol>

      <Card className="mt-10 border-dashed bg-muted/40 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-[var(--reonic-blue)]" />
          <div>
            <p className="text-sm font-medium">Sweet spot</p>
            <p className="text-sm text-muted-foreground">
              You&apos;re currently sized for self-consumption. Adding 2 more panels would push you
              closer to 95% energy independence — but extends payback by ~3 years.
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-10 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Back to path
        </Button>
        <Button onClick={onContinue} className="gap-2">
          Get installer brief
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sun;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Phase 5 — Action (installer brief)
 * ────────────────────────────────────────────────────────────────────────── */
function PhaseAction({
  quiz,
  archetype,
  roadmap,
  rec,
  discovery,
  onBack,
  onRestart,
}: {
  quiz: Quiz;
  archetype: Archetype;
  roadmap: RoadmapStep[];
  rec: Recommendation;
  discovery: DiscoveryResult;
  onBack: () => void;
  onRestart: () => void;
}) {
  function downloadBrief() {
    const lines = [
      "REONIC INSTALLER BRIEF",
      "",
      `Address: ${discovery.address}`,
      `Archetype: ${archetype.name} — ${archetype.tagline}`,
      "",
      "ROOF GEOMETRY",
      `  Total area: ${Math.round(discovery.totalArea)} m²`,
      `  Annual sunshine: ${Math.round(discovery.sunshine)} kWh/m²`,
      `  Usable segments: ${rec.usableSegments.length}`,
      "",
      "RECOMMENDED HARDWARE",
      `  Solar:    ${rec.recPanels} panels (${rec.recKwp.toFixed(1)} kWp)`,
      `  Battery:  ${rec.batteryKwh} kWh`,
      `  Inverter: ${rec.inverterKw} kW hybrid`,
      "",
      "FINANCIAL PROJECTION",
      `  System cost:      €${Math.round(rec.systemCost).toLocaleString()}`,
      `  Annual savings:   €${Math.round(rec.annualSavings).toLocaleString()}`,
      `  Payback:          ${isFinite(rec.paybackYears) ? rec.paybackYears.toFixed(1) + " years" : "—"}`,
      `  20-yr ROI:        €${Math.round(rec.roi20y).toLocaleString()}`,
      "",
      "NARRATIVE WHY",
      ...roadmap.map((s, i) => `  Step ${i + 1} (${s.label}): ${s.bridge}`),
      "",
      "USER PROFILE",
      `  Home age:        ${quiz.homeAge}`,
      `  Goal:            ${quiz.goal}`,
      `  EV:              ${quiz.hasEv ? "yes" : "no"}`,
      `  Monthly bill:    €${quiz.monthlyBill}`,
      "",
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");

    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reonic-installer-brief.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        Action
      </span>
      <h2 className="text-3xl font-semibold tracking-tight">
        Your installer brief is ready.
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Download the one-page summary and we&apos;ll connect you with vetted installers who&apos;ve
        worked on homes like yours.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr,1fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Installer brief
              </p>
              <h3 className="mt-1 text-xl font-semibold">{discovery.address.split(",")[0]}</h3>
            </div>
            <div className="rounded-md border border-border bg-muted px-2 py-1 text-xs">
              {archetype.name}
            </div>
          </div>

          <Separator className="my-5" />

          <BriefSection title="Roof geometry">
            <BriefRow label="Total area" value={`${Math.round(discovery.totalArea)} m²`} />
            <BriefRow
              label="Annual sunshine"
              value={`${Math.round(discovery.sunshine)} kWh/m²`}
            />
            <BriefRow label="Usable segments" value={`${rec.usableSegments.length}`} />
          </BriefSection>

          <BriefSection title="Recommended hardware">
            <BriefRow label="Solar" value={`${rec.recPanels} × 475W (${rec.recKwp.toFixed(1)} kWp)`} />
            <BriefRow label="Battery" value={`${rec.batteryKwh} kWh`} />
            <BriefRow label="Inverter" value={`${rec.inverterKw} kW hybrid`} />
          </BriefSection>

          <BriefSection title="Financials">
            <BriefRow label="System cost" value={`€${Math.round(rec.systemCost).toLocaleString()}`} />
            <BriefRow
              label="Annual savings"
              value={`€${Math.round(rec.annualSavings).toLocaleString()}`}
            />
            <BriefRow
              label="Payback"
              value={
                isFinite(rec.paybackYears) ? `${rec.paybackYears.toFixed(1)} yrs` : "—"
              }
            />
            <BriefRow label="20-yr ROI" value={`€${Math.round(rec.roi20y).toLocaleString()}`} />
          </BriefSection>

          <Button onClick={downloadBrief} className="mt-6 w-full gap-2">
            <Download className="h-4 w-4" />
            Download my installer brief
          </Button>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Next step
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              Connect with 3 vetted installers
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              We pre-filter installers with experience on homes like yours — similar households,
              similar roof size, comparable system.
            </p>
            <Button variant="default" className="mt-5 w-full">
              Find my installers
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              No spam. You pick who to talk to.
            </p>
          </Card>

          <Card className="p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Project progress
            </p>
            <Progress value={100} className="mt-3" />
            <p className="mt-2 text-sm">All 5 phases complete.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onRestart}
              className="mt-4 w-full"
            >
              Start over with a new address
            </Button>
          </Card>
        </div>
      </div>

      <div className="mt-10">
        <Button variant="ghost" onClick={onBack}>
          ← Back to roadmap
        </Button>
      </div>
    </section>
  );
}

function BriefSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * API key editor
 * ────────────────────────────────────────────────────────────────────────── */
function ApiKeyEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (k: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-[var(--reonic-blue)]" />
          <h3 className="text-lg font-semibold">Google Maps API key</h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          We call the Google Solar API directly from your browser. The key is stored only in
          your local storage.
        </p>
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="AIza…"
          className="mt-4"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(val.trim())} disabled={!val.trim()}>
            Save key
          </Button>
        </div>
      </Card>
    </div>
  );
}
