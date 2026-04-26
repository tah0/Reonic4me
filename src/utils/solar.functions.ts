import { createServerFn } from "@tanstack/react-start";
import type { SolarResponse } from "@/lib/solar";

export const fetchSolarServer = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { lat: number; lon: number; quality?: "HIGH" | "MEDIUM" | "LOW" }) => input,
  )
  .handler(async ({ data }): Promise<SolarResponse> => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return { error: { message: "GOOGLE_MAPS_API_KEY is not configured on the server." } };
    }
    const quality = data.quality ?? "HIGH";
    const url =
      `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
      `?location.latitude=${data.lat}&location.longitude=${data.lon}` +
      `&requiredQuality=${quality}&key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url);
      return (await res.json()) as SolarResponse;
    } catch (e) {
      return { error: { message: (e as Error).message } };
    }
  });
