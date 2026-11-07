"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import { useEffect, useRef } from "react";

const VIEW_W = 1200;
const VIEW_H = 760;

const nodes = [
  { x: 208, y: 84, r: 4, tone: "text-muted-foreground" },
  { x: 120, y: 152, r: 5.5, tone: "text-moss" },
  { x: 86, y: 318, r: 3.5, tone: "text-muted-foreground" },
  { x: 248, y: 240, r: 6, tone: "text-saffron", label: "idea" },
  { x: 168, y: 424, r: 3, tone: "text-muted-foreground" },
  { x: 300, y: 340, r: 4.5, tone: "text-sky" },
  { x: 936, y: 120, r: 3.5, tone: "text-muted-foreground" },
  { x: 1082, y: 142, r: 5.5, tone: "text-saffron" },
  { x: 980, y: 262, r: 6.5, tone: "text-moss", label: "question" },
  { x: 1116, y: 330, r: 3.5, tone: "text-muted-foreground" },
  { x: 1012, y: 432, r: 4.5, tone: "text-lilac" },
  { x: 336, y: 636, r: 3.5, tone: "text-muted-foreground" },
  { x: 520, y: 700, r: 3, tone: "text-muted-foreground" },
  { x: 598, y: 646, r: 5, tone: "text-sky", label: "thread" },
  { x: 782, y: 542, r: 3.5, tone: "text-muted-foreground" },
  { x: 902, y: 624, r: 4.5, tone: "text-saffron" },
  { x: 664, y: 150, r: 3.5, tone: "text-muted-foreground", label: "note" },
];

const edges: Array<[number, number]> = [
  [0, 1],
  [1, 3],
  [3, 5],
  [2, 1],
  [2, 4],
  [4, 5],
  [6, 7],
  [7, 8],
  [8, 9],
  [8, 10],
  [9, 10],
  [6, 8],
  [11, 12],
  [12, 13],
  [13, 14],
  [14, 15],
  [12, 15],
  [5, 6],
  [4, 11],
  [3, 16],
  [16, 8],
];

const NODE_RADIUS = 220;
const EDGE_RADIUS = 250;
const LINK_RADIUS = 250;

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function HeroConstellation({ className }: { className?: string }) {
  const rootRef = useRef<SVGSVGElement | null>(null);
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const edgeRefs = useRef<Array<SVGLineElement | null>>([]);
  const linkRef = useRef<SVGLineElement | null>(null);

  useEffect(() => {
    const svg = rootRef.current;
    if (!svg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let pointer: { x: number; y: number } | null = null;

    const update = () => {
      raf = 0;
      let nearest = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;

      nodeRefs.current.forEach((group, index) => {
        if (!group) return;
        const node = nodes[index];
        const distance = pointer
          ? Math.hypot(pointer.x - node.x, pointer.y - node.y)
          : Number.POSITIVE_INFINITY;
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
        const intensity = pointer ? smoothstep(1 - distance / NODE_RADIUS) : 0;
        group.style.opacity = String(0.3 + intensity * 0.7);
      });

      edgeRefs.current.forEach((line, index) => {
        if (!line) return;
        const from = nodes[edges[index][0]];
        const to = nodes[edges[index][1]];
        const distance = pointer
          ? distanceToSegment(pointer.x, pointer.y, from.x, from.y, to.x, to.y)
          : Number.POSITIVE_INFINITY;
        const intensity = pointer ? smoothstep(1 - distance / EDGE_RADIUS) : 0;
        line.style.strokeOpacity = String(0.12 + intensity * 0.5);
      });

      const link = linkRef.current;
      if (link) {
        const target = nearest >= 0 && nearestDistance < LINK_RADIUS ? nodes[nearest] : null;
        if (pointer && target) {
          link.setAttribute("x1", String(pointer.x));
          link.setAttribute("y1", String(pointer.y));
          link.setAttribute("x2", String(target.x));
          link.setAttribute("y2", String(target.y));
          link.style.strokeOpacity = String(
            0.45 * smoothstep(1 - nearestDistance / LINK_RADIUS),
          );
        } else {
          link.style.strokeOpacity = "0";
        }
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.bottom < -120 || rect.top > window.innerHeight + 120) {
        pointer = null;
      } else {
        const scale = Math.max(rect.width / VIEW_W, rect.height / VIEW_H);
        pointer = {
          x: (event.clientX - rect.left - rect.width / 2) / scale + VIEW_W / 2,
          y: (event.clientY - rect.top - rect.height / 2) / scale + VIEW_H / 2,
        };
      }
      schedule();
    };

    const onPointerLeave = () => {
      pointer = null;
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);
    schedule();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <svg
      ref={rootRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={cn("pointer-events-none", className)}
    >
      <g>
        {edges.map(([fromIndex, toIndex], index) => {
          const from = nodes[fromIndex];
          const to = nodes[toIndex];
          return (
            <line
              key={`${fromIndex}-${toIndex}`}
              ref={(element) => {
                edgeRefs.current[index] = element;
              }}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              pathLength={1}
              className="constellation-edge text-foreground"
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeWidth={1}
              style={{ animationDelay: `${260 + index * 55}ms` }}
            />
          );
        })}
        <line
          ref={linkRef}
          className="text-saffron"
          stroke="currentColor"
          strokeOpacity={0}
          strokeWidth={1.2}
          x1={0}
          y1={0}
          x2={0}
          y2={0}
          style={{ transition: "stroke-opacity 220ms ease" }}
        />
      </g>
      {nodes.map((node, index) => (
        <g
          key={index}
          ref={(element) => {
            nodeRefs.current[index] = element;
          }}
          className="constellation-node-group"
          style={{ opacity: 0.3 }}
        >
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r}
            className={cn(node.tone, "constellation-node fill-current")}
            style={{
              animationDelay: `${(index % 5) * 0.7}s`,
              animationDuration: `${6.4 + (index % 4) * 0.9}s`,
            }}
          />
          {node.label ? (
            <text
              x={node.x + node.r + 8}
              y={node.y + 3.5}
              className="fill-current font-mono text-[10px] tracking-[0.08em] text-muted-foreground"
              opacity={0.6}
            >
              {node.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
