import {
  canvasBounds,
  connectorPoint,
  type CanvasDocument,
  type CanvasShapeElement,
  type StickyColor,
} from "@notes-learning/domain";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type { RefObject } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";

const STICKY_HEX: Record<StickyColor, string> = {
  saffron: "#f2ddb5",
  moss: "#dce8d5",
  sky: "#dbe8f0",
  lilac: "#e6ddf0",
  rose: "#f0dcda",
  slate: "#e6e4dd",
  paper: "#fbf9f3",
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, maxChars: number): string[] {
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
  return lines;
}

function textSvg(
  value: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fill: string,
  maxChars: number,
  align: "left" | "center" | "right" = "left",
  lineHeight = 1.35,
): string {
  const lines = wrap(value, maxChars);
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
  return `<text x="${textX}" y="${y}" fill="${fill}" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" text-anchor="${anchor}">${lines
    .map(
      (line, index) =>
        `<tspan x="${textX}" dy="${index === 0 ? 0 : fontSize * lineHeight}">${esc(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function shapePath(
  shape: CanvasShapeElement["shape"],
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (shape) {
    case "ellipse":
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" />`;
    case "diamond":
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" />`;
    case "parallelogram":
      return `<polygon points="${x + w * 0.18},${y} ${x + w},${y} ${x + w * 0.82},${y + h} ${x},${y + h}" />`;
    case "hexagon":
      return `<polygon points="${x + w * 0.22},${y} ${x + w * 0.78},${y} ${x + w},${cy} ${x + w * 0.78},${y + h} ${x + w * 0.22},${y + h} ${x},${cy}" />`;
    case "cylinder":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.12}" />`;
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" />`;
  }
}

export interface CanvasExportOptions {
  pageTitles?: Map<string, string>;
  canvasTitles?: Map<string, string>;
  background?: "paper" | "dark" | "transparent";
}

export function canvasToSvg(
  document: CanvasDocument,
  options: CanvasExportOptions = {},
): { svg: string; width: number; height: number; x: number; y: number } {
  const bounds = canvasBounds(document);
  const padding = 80;
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = Math.max(320, bounds.width + padding * 2);
  const height = Math.max(240, bounds.height + padding * 2);
  const dark = options.background === "dark";
  const bg = options.background === "transparent" ? "none" : dark ? "#171713" : "#faf8f2";
  const ink = dark ? "#eee9df" : "#25251f";
  const elementsById = new Map(
    document.elements
      .filter((element) => element.type !== "connector")
      .map((element) => [element.id, element]),
  );

  const parts: string[] = [];
  for (const connector of document.elements.filter((element) => element.type === "connector")) {
    const from = connectorPoint(connector.from, elementsById);
    const to = connectorPoint(connector.to, elementsById);
    const color = connector.color ?? "#8b8b7a";
    const dash =
      connector.style === "dashed"
        ? ' stroke-dasharray="8 6"'
        : connector.style === "dotted"
          ? ' stroke-dasharray="2 5"'
          : "";
    parts.push(
      `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" stroke-width="1.5"${dash} marker-end="url(#arrow)" />`,
    );
    if (connector.label) {
      parts.push(
        textSvg(
          connector.label,
          (from.x + to.x) / 2,
          (from.y + to.y) / 2 - 6,
          160,
          11,
          color,
          30,
          "center",
        ),
      );
    }
  }

  for (const element of document.elements) {
    if (element.type === "connector") continue;
    const base = element;
    if (element.type === "note") {
      parts.push(
        `<rect x="${base.x}" y="${base.y}" width="${base.width}" height="${base.height}" rx="8" fill="${STICKY_HEX[element.color]}" stroke="rgba(0,0,0,0.08)" />`,
      );
      parts.push(
        textSvg(
          element.text,
          base.x + 16,
          base.y + 26,
          base.width - 32,
          14,
          "#25251f",
          Math.max(12, Math.floor(base.width / 8)),
        ),
      );
    } else if (element.type === "shape") {
      const fill = STICKY_HEX[element.color];
      parts.push(
        `<g fill="${fill}" stroke="rgba(0,0,0,0.12)" stroke-width="1">${shapePath(element.shape, base.x, base.y, base.width, base.height)}</g>`,
      );
      if (element.text) {
        const fontSize = element.textSize === "lg" ? 18 : element.textSize === "sm" ? 12 : 14;
        parts.push(
          textSvg(
            element.text,
            base.x + 14,
            base.y + base.height / 2 - 4,
            base.width - 28,
            fontSize,
            "#25251f",
            Math.max(12, Math.floor(base.width / 8)),
            "center",
          ),
        );
      }
    } else if (element.type === "text") {
      parts.push(
        textSvg(
          element.text,
          base.x,
          base.y + element.fontSize,
          base.width,
          element.fontSize,
          element.color,
          Math.max(12, Math.floor(base.width / (element.fontSize * 0.55))),
          element.align ?? "left",
        ),
      );
    } else if (element.type === "frame") {
      parts.push(
        `<rect x="${base.x}" y="${base.y}" width="${base.width}" height="${base.height}" rx="10" fill="none" stroke="${dark ? "#4a4a42" : "#cfccc0"}" stroke-width="1.5" stroke-dasharray="8 6" />`,
      );
      parts.push(textSvg(element.title, base.x + 16, base.y + 24, base.width - 32, 14, ink, 60));
    } else if (element.type === "freehand") {
      const points = element.points.map(([px, py]) => `${base.x + px},${base.y + py}`).join(" ");
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${element.color}" stroke-width="${element.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`,
      );
    } else if (element.type === "image") {
      parts.push(
        `<image href="${esc(element.src)}" x="${base.x}" y="${base.y}" width="${base.width}" height="${base.height}" preserveAspectRatio="xMidYMid slice" />`,
      );
    } else if (element.type === "page") {
      const title = options.pageTitles?.get(element.pageId) ?? "Linked note";
      parts.push(
        `<rect x="${base.x}" y="${base.y}" width="${base.width}" height="${base.height}" rx="10" fill="${dark ? "#232320" : "#ffffff"}" stroke="rgba(0,0,0,0.12)" />`,
      );
      parts.push(
        `<rect x="${base.x}" y="${base.y}" width="${base.width}" height="4" rx="2" fill="#e8892f" />`,
      );
      parts.push(
        textSvg(
          title,
          base.x + 16,
          base.y + 30,
          base.width - 32,
          14,
          ink,
          Math.max(14, Math.floor(base.width / 8)),
        ),
      );
      parts.push(
        textSvg(
          "Linked note · live in Lattice",
          base.x + 16,
          base.y + 50,
          base.width - 32,
          9,
          dark ? "#8b8b80" : "#7b7b70",
          40,
        ),
      );
    } else if (element.type === "canvas") {
      const title = options.canvasTitles?.get(element.canvasId) ?? "Nested canvas";
      parts.push(
        `<rect x="${base.x}" y="${base.y}" width="${base.width}" height="${base.height}" rx="10" fill="${dark ? "#232320" : "#ffffff"}" stroke="rgba(47,107,79,0.35)" />`,
      );
      parts.push(textSvg(title, base.x + 16, base.y + 30, base.width - 32, 14, ink, 30));
      parts.push(
        textSvg("Nested canvas", base.x + 16, base.y + 50, base.width - 32, 9, "#2f6b4f", 40),
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8b7a" />
    </marker>
  </defs>
  ${bg === "none" ? "" : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${bg}" />`}
  ${parts.join("\n  ")}
</svg>`;
  return { svg, width, height, x, y };
}

async function writeCacheFile(name: string, contents: string): Promise<File> {
  const file = new File(Paths.cache, name);
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  await file.write(contents);
  return file;
}

export async function shareCanvasSvg(svg: string, filename: string): Promise<void> {
  const file = await writeCacheFile(filename, svg);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available");
  await Sharing.shareAsync(file.uri, {
    mimeType: "image/svg+xml",
    dialogTitle: "Export canvas",
    UTI: "public.svg-image",
  });
}

export async function shareCanvasPdf(
  svg: string,
  width: number,
  height: number,
  filename: string,
): Promise<void> {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"/><style>html,body{margin:0;padding:0;background:#faf8f2}svg{width:100%;height:auto;display:block}</style></head><body>${svg}</body></html>`;
  const result = await Print.printToFileAsync({
    html,
    width: Math.max(320, Math.min(2000, width)),
    height: Math.max(240, Math.min(2000, height)),
  });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available");
  await Sharing.shareAsync(result.uri, {
    mimeType: "application/pdf",
    dialogTitle: filename,
    UTI: "com.adobe.pdf",
  });
}

export async function shareViewPng(
  ref: RefObject<View | null>,
  filename: string,
): Promise<void> {
  if (!ref.current) throw new Error("The canvas is not ready to export");
  const uri = await captureRef(ref, { format: "png", quality: 1, result: "tmpfile" });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available");
  await Sharing.shareAsync(uri, {
    mimeType: "image/png",
    dialogTitle: filename,
    UTI: "public.png",
  });
}
