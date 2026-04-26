import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getWeather } from "@/utils/weather.functions";
import { Cloud, CloudRain, Loader2 } from "lucide-react";

interface WeatherBadgeProps {
  location: string | null;
}

export function WeatherBadge({ location }: WeatherBadgeProps) {
  const fetchWeather = useServerFn(getWeather);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!location) {
      setSummary(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchWeather({ data: { location } })
      .then((res) => {
        if (!cancelled) setSummary(res.summary);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location, fetchWeather]);

  if (!location) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Checking weather…</span>
          </>
        ) : error ? (
          <>
            <CloudRain className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Weather unavailable</span>
          </>
        ) : (
          <>
            <Cloud className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="line-clamp-2 leading-snug">{summary}</span>
          </>
        )}
      </div>
    </div>
  );
}
