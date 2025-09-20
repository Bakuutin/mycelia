import React, { useEffect, useRef, useState } from "react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateOrRedirect } from "@/lib/auth/core.server.ts";
import { getFsResource } from "@/lib/mongo/fs.server.ts";
 

type TrackFile = {
  _id: string;
  filename: string;
  metadata?: Record<string, any>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOrRedirect(request);
  const fs = await getFsResource(auth);
  const files = await fs({ action: "find", bucket: "uploads", query: { "metadata.kind": "track" } });
  const tracks: TrackFile[] = files.map((f: any) => ({ _id: String(f._id), filename: f.filename, metadata: f.metadata }));
  return { tracks };
}

export default function MapPage() {
  const { tracks } = useLoaderData<{ tracks: TrackFile[] }>();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<any>(null);
  const [polylines, setPolylines] = useState<any[]>([]);
  const leafletRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);

  useEffect(() => {
    if (map) return;
    if (!mapRef.current) return;
    let cancelled = false;
    const setup = async () => {
      const leafletMod: any = await import("npm:leaflet@1.9.4");
      await import("npm:leaflet@1.9.4/dist/leaflet.css");
      const L = leafletMod.default || leafletMod;
      leafletRef.current = L;
      if (cancelled) return;
      const m = L.map(mapRef.current).setView([0, 0], 2);
      tileLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
        opacity: 0.6,
      }).addTo(m);
      setMap(m);
    };
    setup();
    return () => {
      cancelled = true;
    };
  }, [mapRef.current]);

  useEffect(() => {
    if (!map) return;
    if (!leafletRef.current) return;
    let cancelled = false;
    const setupD3 = async () => {
      const d3: any = await import("npm:d3@7");
      const world = await fetch("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson").then((r) => r.json());
      if (cancelled) return;
      const countries = world;
      const pane = map.createPane("d3bg");
      pane.style.zIndex = "180";
      pane.style.pointerEvents = "none";
      pane.classList.add("leaflet-zoom-animated");
      const svg = d3.select(pane).append("svg").style("position", "absolute");
      const group = svg.append("g");

      const reset = () => {
        type D3TransformContext = { stream: { point: (x: number, y: number) => void } };
        const transform = d3.geoTransform({
          point: function (this: D3TransformContext, lon: number, lat: number) {
            const projected = map.latLngToLayerPoint([lat, lon]);
            this.stream.point(projected.x, projected.y);
          },
        });
        const path = d3.geoPath(transform);
        const bounds: [[number, number], [number, number]] = path.bounds(countries);
        const topLeft = bounds[0];
        const bottomRight = bounds[1];
        const width = bottomRight[0] - topLeft[0];
        const height = bottomRight[1] - topLeft[1];
        svg.attr("width", width).attr("height", height);
        svg.style("left", `${topLeft[0]}px`).style("top", `${topLeft[1]}px`);
        group.attr("transform", `translate(${-topLeft[0]},${-topLeft[1]})`);
        const selection = group.selectAll("path").data(countries.features);
        selection
          .join(
            (enter: any) => enter.append("path"),
            (update: any) => update,
            (exit: any) => exit.remove()
          )
          .attr("d", path)
          .attr("fill", "#0b1020")
          .attr("stroke", "#1f2937")
          .attr("stroke-width", 0.5);
      };

      reset();
      map.on("move zoom", reset);
      return () => {
        map.off("move zoom", reset);
        svg.remove();
        pane.remove();
      };
    };

    let disposer: any;
    setupD3().then((cleanup) => {
      disposer = cleanup;
    });
    return () => {
      cancelled = true;
      if (disposer) disposer();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (!leafletRef.current) return;
    const L = leafletRef.current;
    let cancelled = false;
    const loadAll = async () => {
      if (cancelled) return;
      polylines.forEach((p) => p.remove());
      const next: any[] = [];
      const bounds = L.latLngBounds([]);
      for (const t of tracks) {
        const url = `/api/files/${t._id}`;
        const res = await fetch(url);
        const text = await res.text();
        let coords: Array<[number, number]> = [];
        if (t.metadata?.extension?.toLowerCase() === "gpx" || text.includes("<gpx")) {
          const xml = new DOMParser().parseFromString(text, "application/xml");
          const pts = Array.from(xml.getElementsByTagName("trkpt"));
          coords = pts.map((pt) => [parseFloat(pt.getAttribute("lat") || "0"), parseFloat(pt.getAttribute("lon") || "0")]);
        } else {
          try {
            const gj = JSON.parse(text);
            const flatten = (g: any, acc: Array<[number, number]> = []) => {
              const type = g.type;
              if (type === "FeatureCollection") g.features.forEach((f: any) => flatten(f, acc));
              else if (type === "Feature") flatten(g.geometry, acc);
              else if (type === "LineString") g.coordinates.forEach((c: any) => acc.push([c[1], c[0]]));
              else if (type === "MultiLineString") g.coordinates.forEach((ls: any) => ls.forEach((c: any) => acc.push([c[1], c[0]])));
              return acc;
            };
            coords = flatten(gj, []);
          } catch {
            coords = [];
          }
        }

        if (coords.length > 1) {
          const poly = L.polyline(coords, { color: "#ef4444", weight: 3, opacity: 0.9 }).addTo(map);
          next.push(poly);
          coords.forEach(([lat, lng]) => bounds.extend([lat, lng]));
        }
      }
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
      setPolylines(next);
    };

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [map, tracks.map(t => t._id).join(",")]);

  return (
    <div className="w-full h-[80vh]">
      <div ref={mapRef} className="w-full h-full rounded-md overflow-hidden border border-gray-800" />
    </div>
  );
}




