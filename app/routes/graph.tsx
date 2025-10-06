import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

type EntityType = "person" | "organization" | "place" | "event" | "object" | "concept";

interface EntityNode {
  id: string;
  type: EntityType;
  name: string;
}

interface RelationEdge {
  id: string;
  type: string;
  subject: string;
  object: string;
  metadata?: Record<string, unknown>;
}

type RawItem = EntityNode | RelationEdge;

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  group: EntityType;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
}

const rawItems: RawItem[] = [
  { id: "entity_1", type: "person", name: "Я" },
  { id: "entity_2", type: "person", name: "Яна" },
  { id: "entity_3", type: "person", name: "Света" },
  { id: "entity_4", type: "person", name: "Яша" },
  { id: "entity_5", type: "person", name: "Бабушка-водитель" },
  { id: "entity_6", type: "person", name: "Мент" },
  { id: "entity_7", type: "person", name: "Девочка" },
  { id: "entity_8", type: "organization", name: "Мегавольт" },
  { id: "entity_9", type: "place", name: "Школа" },
  { id: "entity_10", type: "place", name: "Лента" },
  { id: "entity_11", type: "place", name: "Балтийская" },
  { id: "entity_12", type: "place", name: "Восстания" },
  { id: "entity_13", type: "place", name: "Обводный" },
  { id: "entity_14", type: "place", name: "Лиговский" },
  { id: "entity_15", type: "event", name: "Встреча диггеров и руферов" },
  { id: "entity_16", type: "place", name: "Высотное/Подземное Петербург" },
  { id: "entity_17", type: "place", name: "Крыша" },
  { id: "entity_18", type: "place", name: "Подземелья Питера" },
  { id: "entity_19", type: "object", name: "Автобус" },
  { id: "entity_20", type: "object", name: "Велосипед" },
  { id: "entity_21", type: "concept", name: "Принтер" },
  { id: "entity_22", type: "concept", name: "Интернет" },
  { id: "entity_23", type: "event", name: "Помощь с принтером" },
  { id: "entity_24", type: "person", name: "Мама Яны" },
  { id: "entity_25", type: "place", name: "Дом" },
  { id: "entity_26", type: "object", name: "Планшет" },
  { id: "entity_27", type: "object", name: "Картридж" },
  { id: "entity_28", type: "object", name: "Задний тормоз" },
  { id: "entity_29", type: "organization", name: "Охрана" },
  { id: "entity_30", type: "organization", name: "ВКонтакте" },
  { id: "entity_31", type: "object", name: "Счетчик барабана" },
  {
    id: "relation_1",
    type: "helped_with",
    subject: "entity_1",
    object: "entity_21",
    metadata: { context: "helping Яниной маме" },
  },
  {
    id: "relation_2",
    type: "gave",
    subject: "entity_24",
    object: "entity_1",
    metadata: { item: "оладушки" },
  },
  {
    id: "relation_3",
    type: "involved_in",
    subject: "entity_1",
    object: "entity_5",
    metadata: { accident_type: "ДТП" },
  },
  {
    id: "relation_4",
    type: "avoided",
    subject: "entity_1",
    object: "entity_19",
    metadata: { near_miss: "Almost hit by bus" },
  },
  {
    id: "relation_5",
    type: "received",
    subject: "entity_6",
    object: "entity_1",
    metadata: {
      fine_amount: "700 рублей",
      reason: "riding through площадь instead of пешеходный переход",
    },
  },
  {
    id: "relation_6",
    type: "attended",
    subject: "entity_1",
    object: "entity_15",
    metadata: { location: "entity_16" },
  },
  { id: "relation_7", type: "climbed", subject: "entity_1", object: "entity_17" },
  { id: "relation_8", type: "interested_in", subject: "entity_1", object: "entity_18" },
  {
    id: "relation_9",
    type: "wrote",
    subject: "entity_7",
    object: "entity_1",
    metadata: { context: "wrote in VK" },
  },
  { id: "relation_10", type: "collecting_autograph", subject: "entity_1", object: "entity_8" },
  { id: "relation_11", type: "agent", subject: "entity_1", object: "entity_23" },
  { id: "relation_12", type: "beneficiary", subject: "entity_24", object: "entity_23" },
  { id: "relation_13", type: "instrument", subject: "entity_21", object: "entity_23" },
  { id: "relation_14", type: "accompanied", subject: "entity_2", object: "entity_3" },
  { id: "relation_15", type: "attends", subject: "entity_2", object: "entity_9" },
  { id: "relation_16", type: "visited", subject: "entity_1", object: "entity_10" },
  { id: "relation_17", type: "located_at", subject: "entity_10", object: "entity_11" },
  { id: "relation_18", type: "topped_up", subject: "entity_1", object: "entity_22", metadata: { device: "entity_26" } },
  { id: "relation_19", type: "boarded", subject: "entity_1", object: "entity_19", metadata: { from: "entity_12", to: "entity_13", duration_minutes: 10 } },
  { id: "relation_20", type: "held_at", subject: "entity_15", object: "entity_17" },
  { id: "relation_21", type: "located_at", subject: "entity_17", object: "entity_14" },
  { id: "relation_22", type: "noticed", subject: "entity_29", object: "entity_15" },
  { id: "relation_23", type: "printed_assignment", subject: "entity_1", object: "entity_4", metadata: { subject: "математика" } },
  { id: "relation_24", type: "reset", subject: "entity_1", object: "entity_31" },
  { id: "relation_25", type: "bought", subject: "entity_24", object: "entity_27" },
  { id: "relation_26", type: "failure", subject: "entity_20", object: "entity_28" },
  { id: "relation_27", type: "apologized", subject: "entity_5", object: "entity_1" },
  { id: "relation_28", type: "visited", subject: "entity_1", object: "entity_12" },
  { id: "relation_29", type: "visited", subject: "entity_1", object: "entity_13" },
  { id: "relation_30", type: "wrote_via", subject: "entity_7", object: "entity_30" },
  { id: "relation_31", type: "plan_to_find_entrance", subject: "entity_7", object: "entity_18" },
  { id: "relation_32", type: "located_at", subject: "entity_23", object: "entity_25" },
  { id: "relation_33", type: "beneficiary", subject: "entity_4", object: "entity_23" },
  { id: "relation_34", type: "accompanied", subject: "entity_2", object: "entity_24" },
  { id: "relation_35", type: "used_device", subject: "entity_1", object: "entity_26" },
  { id: "relation_36", type: "organized_by", subject: "entity_15", object: "entity_16" },
  { id: "relation_37", type: "owns", subject: "entity_1", object: "entity_20" },
];

function useGraphData(items: RawItem[]) {
  return useMemo(() => {
    const entityItems = items.filter((i): i is EntityNode => (i as EntityNode).name !== undefined);
    const relationItems = items.filter((i): i is RelationEdge => (i as RelationEdge).subject !== undefined);

    const nodes: GraphNode[] = entityItems.map((e) => ({ id: e.id, label: e.name, group: e.type }));
    const links: GraphLink[] = relationItems.map((r) => ({ source: r.subject, target: r.object, relation: r.type }));
    return { nodes, links };
  }, [items]);
}

function getNodeColor(type: EntityType) {
  const palette: Record<EntityType, string> = {
    person: "#0ea5e9",
    organization: "#8b5cf6",
    place: "#10b981",
    event: "#f59e0b",
    object: "#ef4444",
    concept: "#14b8a6",
  };
  return palette[type] ?? "#64748b";
}

export default function Graph() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const { nodes, links } = useGraphData(rawItems);

  const [linkDistance, setLinkDistance] = useState<number>(100);
  const [chargeStrength, setChargeStrength] = useState<number>(-250);
  const [collisionRadius, setCollisionRadius] = useState<number>(28);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height || 640));

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "w-full h-full bg-background text-foreground");
    svgRef.current = svg.node();

    const defs = svg.append("defs");
    const marker = defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 10)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto");
    marker.append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#94a3b8");

    const zoomGroup = svg.append("g");

    const linkSelection = zoomGroup
      .append("g")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.6)
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow)");

    const linkLabelSelection = zoomGroup
      .append("g")
      .selectAll<SVGTextElement, GraphLink>("text")
      .data(links)
      .join("text")
      .attr("font-size", 11)
      .attr("fill", "#94a3b8")
      .attr("text-anchor", "middle")
      .style("pointer-events", "none")
      .text((d) => d.relation);

    const nodeGroup = zoomGroup
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g");

    const nodeCircles = nodeGroup
      .append("circle")
      .attr("r", 14)
      .attr("fill", (d) => getNodeColor(d.group))
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 1.5);

    const nodeLabels = nodeGroup
      .append("text")
      .attr("x", 18)
      .attr("y", 4)
      .attr("font-size", 12)
      .attr("fill", "#e2e8f0")
      .text((d) => d.label);

    const dragBehavior = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeGroup.call(dragBehavior as unknown as d3.DragBehavior<SVGGElement, GraphNode, GraphNode>);

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(linkDistance))
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(collisionRadius));

    simulationRef.current = simulation;

    const nodeRadius = 14;

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (d) => {
          const sx = typeof d.source === "string" ? 0 : d.source.x ?? 0;
          const tx = typeof d.target === "string" ? 0 : d.target.x ?? 0;
          const dx = tx - sx;
          const dy = (typeof d.target === "string" ? 0 : d.target.y ?? 0) - (typeof d.source === "string" ? 0 : d.source.y ?? 0);
          const dist = Math.hypot(dx, dy) || 1;
          return sx + (dx / dist) * nodeRadius;
        })
        .attr("y1", (d) => {
          const sy = typeof d.source === "string" ? 0 : d.source.y ?? 0;
          const tx = typeof d.target === "string" ? 0 : d.target.x ?? 0;
          const dx = tx - (typeof d.source === "string" ? 0 : d.source.x ?? 0);
          const dy = (typeof d.target === "string" ? 0 : d.target.y ?? 0) - sy;
          const dist = Math.hypot(dx, dy) || 1;
          return sy + (dy / dist) * nodeRadius;
        })
        .attr("x2", (d) => {
          const sx = typeof d.source === "string" ? 0 : d.source.x ?? 0;
          const tx = typeof d.target === "string" ? 0 : d.target.x ?? 0;
          const dx = tx - sx;
          const dy = (typeof d.target === "string" ? 0 : d.target.y ?? 0) - (typeof d.source === "string" ? 0 : d.source.y ?? 0);
          const dist = Math.hypot(dx, dy) || 1;
          return tx - (dx / dist) * nodeRadius;
        })
        .attr("y2", (d) => {
          const sy = typeof d.source === "string" ? 0 : d.source.y ?? 0;
          const ty = typeof d.target === "string" ? 0 : d.target.y ?? 0;
          const dx = (typeof d.target === "string" ? 0 : d.target.x ?? 0) - (typeof d.source === "string" ? 0 : d.source.x ?? 0);
          const dy = ty - sy;
          const dist = Math.hypot(dx, dy) || 1;
          return ty - (dy / dist) * nodeRadius;
        });

      linkLabelSelection
        .attr("x", (d) => {
          const sx = typeof d.source === "string" ? 0 : d.source.x ?? 0;
          const tx = typeof d.target === "string" ? 0 : d.target.x ?? 0;
          const dx = tx - sx;
          const dy = (typeof d.target === "string" ? 0 : d.target.y ?? 0) - (typeof d.source === "string" ? 0 : d.source.y ?? 0);
          const dist = Math.hypot(dx, dy) || 1;
          const mx = (sx + tx) / 2;
          return mx - (dx / dist) * 10;
        })
        .attr("y", (d) => {
          const sy = typeof d.source === "string" ? 0 : d.source.y ?? 0;
          const ty = typeof d.target === "string" ? 0 : d.target.y ?? 0;
          const dx = (typeof d.target === "string" ? 0 : d.target.x ?? 0) - (typeof d.source === "string" ? 0 : d.source.x ?? 0);
          const dy = ty - sy;
          const dist = Math.hypot(dx, dy) || 1;
          const my = (sy + ty) / 2;
          return my - (dy / dist) * 10;
        });

      nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    const zoomed = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      zoomGroup.attr("transform", event.transform.toString());
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 4]).on("zoom", zoomed);
    svg.call(zoom as unknown as d3.ZoomBehavior<SVGSVGElement, unknown>);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !svgRef.current) return;
      const cr = container.getBoundingClientRect();
      const w = Math.max(320, Math.floor(cr.width));
      const h = Math.max(320, Math.floor(cr.height || 640));
      d3.select(svgRef.current).attr("width", w).attr("height", h);
      if (simulationRef.current) simulationRef.current.force("center", d3.forceCenter(w / 2, h / 2)).alpha(0.2).restart();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      simulation.stop();
      svg.remove();
      simulationRef.current = null;
      svgRef.current = null;
    };
  }, [nodes, links]);

  useEffect(() => {
    if (!simulationRef.current) return;
    simulationRef.current
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(linkDistance))
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("collision", d3.forceCollide().radius(collisionRadius));
    simulationRef.current.alpha(0.3).restart();
  }, [linkDistance, chargeStrength, collisionRadius, links]);

  return (
    <div ref={containerRef} className="relative w-full h-[calc(100svh-2rem)] p-4">
      <div className="absolute top-4 left-4 z-10 rounded-md bg-slate-800/80 p-3 text-slate-100 shadow">
        <div className="mb-2">
          <label className="block text-xs mb-1">Link distance: {linkDistance}</label>
          <input
            type="range"
            min={20}
            max={300}
            value={linkDistance}
            onChange={(e) => setLinkDistance(Number(e.target.value))}
            className="w-56"
          />
        </div>
        <div className="mb-2">
          <label className="block text-xs mb-1">Charge strength: {chargeStrength}</label>
          <input
            type="range"
            min={-800}
            max={0}
            value={chargeStrength}
            onChange={(e) => setChargeStrength(Number(e.target.value))}
            className="w-56"
          />
        </div>
        <div>
          <label className="block text-xs mb-1">Collision radius: {collisionRadius}</label>
          <input
            type="range"
            min={5}
            max={60}
            value={collisionRadius}
            onChange={(e) => setCollisionRadius(Number(e.target.value))}
            className="w-56"
          />
        </div>
      </div>
    </div>
  );
}


