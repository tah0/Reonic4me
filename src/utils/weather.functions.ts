import { createServerFn } from "@tanstack/react-start";

export const getWeather = createServerFn({ method: "POST" })
  .inputValidator((data: { location: string }) => {
    if (!data?.location || typeof data.location !== "string") {
      throw new Error("location is required");
    }
    const trimmed = data.location.trim().slice(0, 200);
    if (!trimmed) throw new Error("location is required");
    return { location: trimmed };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `current weather conditions in ${data.location}`,
        search_depth: "basic",
        include_answer: true,
        max_results: 3,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { answer?: string };
    const answer = (json.answer ?? "").trim();
    return { summary: answer || "Weather data unavailable right now." };
  });
