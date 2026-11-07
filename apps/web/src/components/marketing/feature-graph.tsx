"use client";

import { useState } from "react";

const nodes = [
  { x: 110, y: 48, r: 12, tone: "text-saffron", label: "Knowledge graph" },
  { x: 38, y: 24, r: 7, tone: "text-moss", label: "Local-first" },
  { x: 180, y: 26, r: 6, tone: "text-lilac", label: "Concepts" },
  { x: 52, y: 78, r: 5.5, tone: "text-sky", label: "Flashcards" },
  { x: 176, y: 74, r: 7, tone: "text-rose", label: "Projects" },
];

const edges = [
  { from: 0, to: 1, relation: "depends on" },
  { from: 0, to: 2, relation: "example of" },
  { from: 0, to: 3, relation: "prerequisite" },
  { from: 0, to: 4, relation: "part of" },
  { from: 1, to: 2, relation: "related to" },
  { from: 3, to: 4, relation: "explains" },
];

export function FeatureGraph() {
  const [active, setActive] = useState<number | null>(null);

  const isLinked = (index: number) =>
    active !== null &&
    edges.some(
      (edge) =>
        (edge.from === active && edge.to === index) ||
        (edge.to === active && edge.from === index),
    );

  return (
    <svg viewBox="0 0 220 96" className="mt-5 h-24 w-full" aria-hidden="true">
      {edges.map((edge, index) => {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        const activeEdge = active !== null && (edge.from === active || edge.to === active);
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              pathLength={1}
              className="edge-draw fg-edge text-foreground"
              stroke="currentColor"
              strokeWidth={1}
              style={{
                animationDelay: `${index * 130 + 200}ms`,
                strokeOpacity: activeEdge ? 0.7 : active === null ? 0.3 : 0.1,
              }}
            />
            <text
              x={(from.x + to.x) / 2}
              y={(from.y + to.y) / 2 - 3}
              textAnchor="middle"
              className="fill-current font-mono text-[6.5px] text-muted-foreground transition-opacity duration-200"
              style={{ opacity: activeEdge ? 0.95 : 0 }}
            >
              {edge.relation}
            </text>
          </g>
        );
      })}
      {nodes.map((node, index) => {
        const dimmed = active !== null && active !== index && !isLinked(index);
        return (
          <g
            key={node.label}
            className="fg-node cursor-pointer"
            style={{
              transform: active === index ? "scale(1.16)" : "scale(1)",
              opacity: dimmed ? 0.3 : 1,
            }}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() =>
              setActive((current) => (current === index ? null : current))
            }
            onClick={() => setActive((current) => (current === index ? null : index))}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r + 12}
              fill="transparent"
              pointerEvents="all"
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              className={`${node.tone} ${index === 0 ? "node-breathe" : ""} fill-current`}
            />
            <text
              x={node.x}
              y={node.y + node.r + 11}
              textAnchor="middle"
              className="fill-current font-mono text-[7px] text-muted-foreground transition-opacity duration-200"
              style={{ opacity: active === index ? 1 : 0 }}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
