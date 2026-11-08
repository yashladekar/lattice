import {
  connectorPoint,
  type CanvasConnectorElement,
  type CanvasDocument,
  type CanvasElement,
  type StickyColor,
} from "@notes-learning/domain";
import {
  Circle,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  Line,
  Marker,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
  TSpan,
} from "react-native-svg";

export const STICKY_HEX: Record<StickyColor, string> = {
  saffron: "#f2ddb5",
  moss: "#dce8d5",
  sky: "#dbe8f0",
  lilac: "#e6ddf0",
  rose: "#f0dcda",
  slate: "#e6e4dd",
  paper: "#fbf9f3",
};

const INK = "#25251f";
const MUTED = "#8b8b7a";

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if ((current + " " + word).trim().length <= maxChars) {
        current = `${current} ${word}`.trim();
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines.slice(0, 14);
}

function Multiline({
  text,
  x,
  y,
  width,
  fontSize,
  color,
  maxChars,
  align = "left",
  fontWeight,
}: {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  maxChars: number;
  align?: "left" | "center" | "right";
  fontWeight?: string;
}) {
  const lines = wrapText(text, maxChars);
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
  return (
    <SvgText
      x={textX}
      y={y}
      fill={color}
      fontSize={fontSize}
      fontWeight={fontWeight}
      textAnchor={anchor}
    >
      {lines.map((line, index) => (
        <TSpan key={index} x={textX} dy={index === 0 ? 0 : fontSize * 1.35}>
          {line}
        </TSpan>
      ))}
    </SvgText>
  );
}

function ShapeOutline({
  element,
}: {
  element: Extract<CanvasElement, { type: "shape" }>;
}) {
  const { x, y, width: w, height: h } = element;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (element.shape) {
    case "ellipse":
      return <Ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} />;
    case "diamond":
      return <Polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} />;
    case "parallelogram":
      return (
        <Polygon
          points={`${x + w * 0.18},${y} ${x + w},${y} ${x + w * 0.82},${y + h} ${x},${y + h}`}
        />
      );
    case "hexagon":
      return (
        <Polygon
          points={`${x + w * 0.22},${y} ${x + w * 0.78},${y} ${x + w},${cy} ${x + w * 0.78},${y + h} ${x + w * 0.22},${y + h} ${x},${cy}`}
        />
      );
    case "cylinder":
      return <Rect x={x} y={y} width={w} height={h} rx={w * 0.12} />;
    default:
      return <Rect x={x} y={y} width={w} height={h} rx={12} />;
  }
}

function freehandPaths(
  element: Extract<CanvasElement, { type: "freehand" }>,
): Array<{ d: string; width: number }> {
  const points = element.points;
  if (points.length < 2) return [];
  const pressures = element.pressures ?? [];
  const base = element.strokeWidth;
  const toPath = (slice: Array<[number, number]>) =>
    slice
      .map(([px, py], index) => `${index === 0 ? "M" : "L"} ${element.x + px} ${element.y + py}`)
      .join(" ");

  if (!pressures.length) {
    return [{ d: toPath(points), width: base }];
  }

  const chunks: Array<{ d: string; width: number }> = [];
  const size = 6;
  for (let start = 0; start < points.length - 1; start += size) {
    const end = Math.min(points.length, start + size + 1);
    const slice = points.slice(start, end);
    if (slice.length < 2) break;
    const pressureSlice = pressures.slice(start, end).filter((value) => Number.isFinite(value));
    const average =
      pressureSlice.reduce((sum, value) => sum + value, 0) /
      Math.max(1, pressureSlice.length);
    chunks.push({
      d: toPath(slice),
      width: Math.max(0.6, base * (0.35 + Math.min(1, Math.max(0, average)) * 1.25)),
    });
  }
  return chunks;
}

function Connector({
  connector,
  elementsById,
}: {
  connector: CanvasConnectorElement;
  elementsById: Map<string, { x: number; y: number; width: number; height: number }>;
}) {
  const from = connectorPoint(connector.from, elementsById);
  const to = connectorPoint(connector.to, elementsById);
  const color = connector.color ?? MUTED;
  const dash =
    connector.style === "dashed" ? "8 6" : connector.style === "dotted" ? "2 5" : undefined;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return (
    <G>
      <Line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={1.6}
        strokeDasharray={dash}
        markerEnd={connector.arrowEnd === false ? undefined : "url(#canvas-arrow)"}
        markerStart={connector.arrowStart ? "url(#canvas-arrow-start)" : undefined}
      />
      {connector.label ? (
        <Multiline
          text={connector.label}
          x={midX - 60}
          y={midY - 8}
          width={120}
          fontSize={11}
          color={color}
          maxChars={28}
          align="center"
        />
      ) : null}
    </G>
  );
}

function ElementView({
  element,
  pageTitle,
  canvasTitle,
}: {
  element: CanvasElement;
  pageTitle?: string;
  canvasTitle?: string;
}) {
  switch (element.type) {
    case "note":
      return (
        <G>
          <Rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={8}
            fill={STICKY_HEX[element.color]}
            stroke="rgba(0,0,0,0.08)"
          />
          <Multiline
            text={element.text}
            x={element.x + 14}
            y={element.y + 26}
            width={element.width - 28}
            fontSize={14}
            color={INK}
            maxChars={Math.max(12, Math.floor(element.width / 8))}
          />
        </G>
      );
    case "shape":
      return (
        <G>
          <G fill={STICKY_HEX[element.color]} stroke="rgba(0,0,0,0.12)" strokeWidth={1}>
            <ShapeOutline element={element} />
          </G>
          {element.text ? (
            <Multiline
              text={element.text}
              x={element.x + 12}
              y={element.y + element.height / 2 - 6}
              width={element.width - 24}
              fontSize={element.textSize === "lg" ? 18 : element.textSize === "sm" ? 12 : 14}
              color={INK}
              maxChars={Math.max(12, Math.floor(element.width / 8))}
              align="center"
            />
          ) : null}
        </G>
      );
    case "text":
      return (
        <Multiline
          text={element.text}
          x={element.x}
          y={element.y + element.fontSize}
          width={element.width}
          fontSize={element.fontSize}
          color={element.color}
          maxChars={Math.max(12, Math.floor(element.width / (element.fontSize * 0.55)))}
          align={element.align ?? "left"}
        />
      );
    case "freehand":
      return (
        <G>
          {freehandPaths(element).map((path, index) => (
            <Path
              key={index}
              d={path.d}
              fill="none"
              stroke={element.color}
              strokeWidth={path.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </G>
      );
    case "frame":
      return (
        <G>
          <Rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={10}
            fill="none"
            stroke="rgba(0,0,0,0.22)"
            strokeWidth={1.5}
            strokeDasharray="8 6"
          />
          <SvgText
            x={element.x + 14}
            y={element.y + 22}
            fill={INK}
            fontSize={13}
            fontWeight="600"
          >
            {element.title || "Frame"}
          </SvgText>
        </G>
      );
    case "image":
      return element.src ? (
        <SvgImage
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          href={element.src}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : null;
    case "page":
      return (
        <G>
          <Rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={10}
            fill="#ffffff"
            stroke="rgba(0,0,0,0.12)"
          />
          <Rect x={element.x} y={element.y} width={element.width} height={4} rx={2} fill="#e8892f" />
          <SvgText x={element.x + 12} y={element.y + 22} fill={INK} fontSize={12} fontWeight="600">
            {pageTitle ?? "Linked note"}
          </SvgText>
          <SvgText x={element.x + 12} y={element.y + 40} fill={MUTED} fontSize={9}>
            Linked note · live in Lattice
          </SvgText>
        </G>
      );
    case "canvas":
      return (
        <G>
          <Rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={10}
            fill="#ffffff"
            stroke="rgba(47,107,79,0.35)"
          />
          <SvgText x={element.x + 12} y={element.y + 22} fill={INK} fontSize={12} fontWeight="600">
            {canvasTitle ?? "Nested canvas"}
          </SvgText>
          <SvgText x={element.x + 12} y={element.y + 40} fill="#2f6b4f" fontSize={9}>
            Nested canvas
          </SvgText>
        </G>
      );
    default:
      return null;
  }
}

export function CanvasElements({
  document,
  selectedIds,
  scale,
  pageTitles,
  canvasTitles,
}: {
  document: CanvasDocument;
  selectedIds: string[];
  scale: number;
  pageTitles?: Map<string, string>;
  canvasTitles?: Map<string, string>;
}) {
  const elementsById = new Map(
    document.elements
      .filter((element) => element.type !== "connector")
      .map((element) => [
        element.id,
        { x: element.x, y: element.y, width: element.width, height: element.height },
      ]),
  );
  const frames = document.elements.filter((element) => element.type === "frame");
  const connectors = document.elements.filter((element) => element.type === "connector");
  const rest = document.elements.filter(
    (element) => element.type !== "frame" && element.type !== "connector",
  );
  const selected = document.elements.filter((element) => selectedIds.includes(element.id));

  return (
    <G>
      <Defs>
        <Marker
          id="canvas-arrow"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto"
        >
          <Path d="M 0 0 L 10 5 L 0 10 z" fill={MUTED} />
        </Marker>
        <Marker
          id="canvas-arrow-start"
          viewBox="0 0 10 10"
          refX={2}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto"
        >
          <Path d="M 10 0 L 0 5 L 10 10 z" fill={MUTED} />
        </Marker>
      </Defs>

      {frames.map((element) => (
        <ElementView key={element.id} element={element} />
      ))}
      {rest.map((element) => (
        <ElementView
          key={element.id}
          element={element}
          pageTitle={element.type === "page" ? pageTitles?.get(element.pageId) : undefined}
          canvasTitle={element.type === "canvas" ? canvasTitles?.get(element.canvasId) : undefined}
        />
      ))}
      {connectors.map((element) => (
        <Connector key={element.id} connector={element} elementsById={elementsById} />
      ))}

      {selected.map((element) => {
        if (element.type === "connector") return null;
        const bounds =
          element.type === "freehand"
            ? (() => {
                const xs = element.points.map(([px]) => element.x + px);
                const ys = element.points.map(([, py]) => element.y + py);
                return {
                  x: Math.min(...xs),
                  y: Math.min(...ys),
                  width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
                  height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
                };
              })()
            : { x: element.x, y: element.y, width: element.width, height: element.height };
        const handle = 8 / Math.max(0.2, scale);
        const strokeWidth = 1.5 / Math.max(0.2, scale);
        return (
          <G key={`selection-${element.id}`}>
            <Rect
              x={bounds.x}
              y={bounds.y}
              width={bounds.width}
              height={bounds.height}
              fill="none"
              stroke="#e07a2e"
              strokeWidth={strokeWidth}
              strokeDasharray={`${6 / scale} ${4 / scale}`}
            />
            {[
              [bounds.x, bounds.y],
              [bounds.x + bounds.width, bounds.y],
              [bounds.x, bounds.y + bounds.height],
              [bounds.x + bounds.width, bounds.y + bounds.height],
            ].map(([cx, cy], index) => (
              <Circle
                key={index}
                cx={cx}
                cy={cy}
                r={handle}
                fill="#ffffff"
                stroke="#e07a2e"
                strokeWidth={strokeWidth}
              />
            ))}
          </G>
        );
      })}

    </G>
  );
}
