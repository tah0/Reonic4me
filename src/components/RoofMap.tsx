import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Layer } from "leaflet";
import type { RoofSegment } from "@/lib/solar";
import { azimuthToDir } from "@/lib/solar";

const SEGMENT_COLORS = ["#4A5685", "#BCDA8A", "#F2D473", "#EF5446"];

interface RoofMapProps {
  lat: number | null;
  lon: number | null;
  segments: RoofSegment[] | null;
}

export function RoofMap({ lat, lon, segments }: RoofMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Layer[]>([]);

  // Init map (client-only)
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        const startLat = lat ?? 52.52;
        const startLon = lon ?? 13.405;
        const startZoom = lat !== null ? 19 : 11;
        mapRef.current = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([startLat, startLon], startZoom);
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 21, attribution: "Tiles © Esri" },
        ).addTo(mapRef.current);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-center on lat/lon change
  useEffect(() => {
    if (lat === null || lon === null) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      mapRef.current.setView([lat, lon], 19);
      // clear old labels
      layersRef.current.forEach((l) => mapRef.current?.removeLayer(l));
      layersRef.current = [];
      if (!segments) return;

      segments.slice(0, 4).forEach((seg, i) => {
        if (!seg.center) return;
        const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]!;
        const text = `${seg.stats.areaMeters2.toFixed(0)}m² ${azimuthToDir(seg.azimuthDegrees)}`;
        const marker = L.marker([seg.center.latitude, seg.center.longitude], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:${color};color:#fff;font-size:11px;font-weight:600;padding:3px 7px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.25);font-family:Geist,sans-serif;">${text}</div>`,
            iconAnchor: [20, 10],
          }),
        });
        marker.addTo(mapRef.current!);
        layersRef.current.push(marker);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lon, segments]);

  // Cleanup
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
