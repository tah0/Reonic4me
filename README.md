# Reonic4me — AI Roof & Energy Roadmap

An AI-assisted renewable-energy planner for residential homes. Enter an address
to analyze the roof via the **Google Solar API**, refine your profile through a
short quiz, and get an archetype-based roadmap (PV, battery, heat pump, EV)
with neighbor-style social proof and a downloadable installer brief.

Built for the **Reonic Track** at BBH 2026.

---

## Tech stack

- **TanStack Start v1** (React 19 + Vite 7) — file-based routing in `src/routes/`
- **Tailwind CSS v4** + **shadcn/ui** + **lucide-react** — design system in `src/styles.css`
- **Server functions** (`createServerFn`) for any call that needs a secret
- **Cloudflare Workers** runtime (via `@cloudflare/vite-plugin`) for SSR/edge
- **Leaflet** for the 2D roof map
- KNN-style neighbor lookup over an anonymized Reonic dataset

### External services

| Service | Purpose | Where the key lives |
|---|---|---|
| Google Solar API | Roof segments, sunshine, panel capacity | `GOOGLE_MAPS_API_KEY` (server secret) |
| Tavily Search API | Live weather badge after analysis | `TAVILY_API_KEY` (server secret) |
| OpenStreetMap / Nominatim | Address autocomplete + geocoding | No key required |

Both API keys are read **server-side only** through TanStack server functions
(`src/utils/solar.functions.ts`, `src/utils/weather.functions.ts`). They are
never bundled into the client.

---

## Project layout

```
src/
├── routes/
│   ├── __root.tsx        # Root layout / SEO shell
│   └── index.tsx         # 5-phase wizard (Discovery → Brief)
├── components/
│   ├── RoofMap.tsx       # Leaflet roof viewer
│   ├── WeatherBadge.tsx  # Tavily-powered pill (bottom-right)
│   └── ui/               # shadcn primitives
├── lib/
│   ├── solar.ts          # Google Solar types + recommendation engine
│   ├── archetype.ts      # Quiz → archetype + roadmap logic
│   └── knn.ts            # Nearest-neighbor lookup over project dataset
├── utils/
│   ├── solar.functions.ts    # Server fn: calls Google Solar with secret key
│   └── weather.functions.ts  # Server fn: calls Tavily with secret key
├── router.tsx
└── styles.css            # Design tokens (oklch)

public/data/projects_combined.csv   # Anonymized Reonic dataset (KNN source)
project_files/                      # Original Python prototype + raw datasets
```

---

## Running on Lovable

This is the recommended path — no local setup needed.

1. **Open the project in Lovable.** The dev preview boots automatically.
2. **Add the runtime secrets** (Project Settings → Cloud → Secrets):
   - `GOOGLE_MAPS_API_KEY` — Google Maps Platform key with the
     [Solar API](https://developers.google.com/maps/documentation/solar) enabled
   - `TAVILY_API_KEY` — from [tavily.com](https://tavily.com)
3. **Use the wizard.** Enter an address → answer the quiz → see your roadmap →
   download the installer brief. The weather badge appears bottom-right after
   discovery.
4. **Publish** when ready — Lovable deploys the SSR app to Cloudflare Workers.

> Secrets added in Lovable are injected as `process.env.*` inside server
> functions only. Nothing is exposed to the browser.

---

## Running locally

Requirements: **Node 20+** and **[bun](https://bun.sh)** (or npm/pnpm).

```bash
# 1. Install dependencies
bun install

# 2. Provide the same secrets as environment variables
export GOOGLE_MAPS_API_KEY=your_google_solar_api_key
export TAVILY_API_KEY=your_tavily_api_key

# 3. Start the dev server (Vite + TanStack Start)
bun run dev
```

Open the URL printed in the terminal (defaults to <http://localhost:5173>).

### Other scripts

```bash
bun run build      # Production build (Cloudflare Worker bundle)
bun run preview    # Preview the production build
bun run lint       # ESLint
bun run format     # Prettier
```

### Notes

- There is **no `.env` file convention** in the Lovable template — secrets are
  read from `process.env` at runtime. For local dev, export them in your shell
  or use a tool like `direnv`. Do **not** commit a `.env`.
- The keys must be exported in the **same shell** that runs `bun run dev`,
  otherwise the server functions return a "not configured" error.
- Address autocomplete uses Nominatim and is rate-limited; for heavy testing
  consider self-hosting or swapping the provider in `src/lib/solar.ts`.

---

## Data

The KNN neighbor lookup reads `public/data/projects_combined.csv` — an
anonymized export of real Reonic installations. The original raw exports and
the Python prototype that produced this file live under `project_files/` for
reference; they are not used at runtime.
