"use client";

import { connectorPoint, type CanvasDocument } from "@notes-learning/domain";

function truncate(value: string, length: number): string {
  const trimmed = value.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length - 1)}…` : trimmed;
}

/**
 * A read-only thumbnail of a generated canvas, shown before the user turns an
 * AI outline into a whiteboard.
 */
export function CanvasPlanPreview({ document }: { document: CanvasDocument }) {
  const nodes = document.elements.filter((element) => element.type !== "connector");
  if (!nodes.length) return null;
  const minX = Math.min(...nodes.map((element) => element.x));
  const minY = Math.min(...nodes.map((element) => element.y));
  const maxX = Math.max(...nodes.map((element) => element.x + element.width));
  const maxY = Math.max(...nodes.map((element) => element.y + element.height));
  const padding = 24;
  const viewBox = `${minX - padding} ${minY - padding} ${Math.max(1, maxX - minX) + padding * 2} ${Math.max(1, maxY - minY) + padding * 2}`;
  const byId = new Map(
    document.elements
      .filter((element) => element.type !== "connector")
      .map((element) => [element.id, element]),
  );

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
      <svg viewBox={viewBox} className="h-48 w-full" role="img" aria-label="Mind map preview">
        {document.elements
          .filter((element) => element.type === "connector")
          .map((connector) => {
            const from = connectorPoint(connector.from, byId);
            const to = connectorPoint(connector.to, byId);
            return (
              <line
                key={connector.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-border"
                strokeWidth={1.5}
              />
            );
          })}
        {nodes.map((element) => {
          if (element.type !== "shape" && element.type !== "note") return null;
          const isRoot = element.type === "shape" && element.shape === "ellipse";
          return (
            <g key={element.id}>
              <rect
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                rx={isRoot ? element.height / 2 : 10}
                className={isRoot ? "fill-saffron/20 stroke-saffron/60" : "fill-card stroke-border"}
                strokeWidth={1.5}
              />
              <text
                x={element.x + element.width / 2}
                y={element.y + element.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground"
                fontSize={Math.max(11, Math.min(18, element.width / 14))}
              >
                {truncate(element.text || "Untitled", 22)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        Preview · the whiteboard opens with these nodes
      </p>
    </div>
  );
}
