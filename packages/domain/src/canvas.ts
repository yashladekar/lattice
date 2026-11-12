import { createId } from "./ids";
import { CANVAS_LAYOUTS } from "./plugins";
import type {
  CanvasCanvasElement,
  CanvasConnectorElement,
  CanvasDocument,
  CanvasFrameElement,
  CanvasNoteElement,
  CanvasPageElement,
  CanvasShapeElement,
  CanvasTextElement,
  OutlineItem,
  StickyColor,
} from "./types";

export function emptyCanvas(): CanvasDocument {
  return { version: 1, elements: [], background: "dots" };
}

/** The layouts a plugin manifest may request, reused here for agent plans. */
export type CanvasLayout = (typeof CANVAS_LAYOUTS)[number];

/**
 * Builds a whiteboard from an outline, with positions decided here rather than
 * by the caller — a model that placed elements itself would produce overlaps.
 * Shared by the mind-map page action and the plan-mode `create_canvas` op.
 */
export function buildCanvasFromOutline(
  layout: CanvasLayout,
  title: string,
  nodes: ReadonlyArray<{ text: string; level?: number }>,
): CanvasDocument {
  const outline: OutlineItem[] = nodes.map((node, index) => ({
    id: createId(),
    level: Math.min(4, Math.max(1, node.level ?? 1)),
    text: node.text,
    pos: index,
  }));
  if (layout === "flow") return createFlowFromOutline(title, outline);
  if (layout === "concept") return createConceptMap(title, outline);
  return createMindMap(title, outline);
}

export function canvasDocument(value: unknown): CanvasDocument {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { elements?: unknown }).elements)
  ) {
    return value as CanvasDocument;
  }
  return emptyCanvas();
}

export function stickyColor(index: number): StickyColor {
  const colors: StickyColor[] = ["saffron", "moss", "sky", "lilac", "rose", "slate"];
  return colors[index % colors.length] ?? "saffron";
}

export function makeNote(
  x: number,
  y: number,
  text: string,
  color: StickyColor = "saffron",
  width = 220,
  height = 160,
): CanvasNoteElement {
  return { id: createId(), type: "note", x, y, width, height, text, color };
}

export function makeShape(
  shape: CanvasShapeElement["shape"],
  x: number,
  y: number,
  text: string,
  color: StickyColor = "paper",
  width = 220,
  height = 120,
): CanvasShapeElement {
  return { id: createId(), type: "shape", shape, x, y, width, height, text, color };
}

export function makeText(x: number, y: number, text: string, fontSize = 20): CanvasTextElement {
  return {
    id: createId(),
    type: "text",
    x,
    y,
    width: 320,
    height: 48,
    text,
    fontSize,
    color: "#1d1d1a",
  };
}

export function makeFrame(
  x: number,
  y: number,
  title: string,
  width = 640,
  height = 420,
): CanvasFrameElement {
  return { id: createId(), type: "frame", x, y, width, height, title, color: "paper" };
}

export function makePageCard(
  pageId: string,
  x: number,
  y: number,
  variant: CanvasPageElement["variant"] = "card",
): CanvasPageElement {
  return { id: createId(), type: "page", pageId, x, y, width: 260, height: 140, variant };
}

export function makeCanvasCard(canvasId: string, x: number, y: number): CanvasCanvasElement {
  return { id: createId(), type: "canvas", canvasId, x, y, width: 260, height: 150 };
}

export function makeConnector(
  from: CanvasConnectorElement["from"],
  to: CanvasConnectorElement["to"],
  label?: string,
): CanvasConnectorElement {
  return {
    id: createId(),
    type: "connector",
    from,
    to,
    arrowEnd: true,
    style: "solid",
    color: "#8b8b7a",
    label,
  };
}

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  category: "Starter" | "Thinking" | "Technical" | "Learning" | "Presentation";
  build: () => CanvasDocument;
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: "blank",
    name: "Blank canvas",
    description: "An empty infinite surface.",
    category: "Starter",
    build: () => emptyCanvas(),
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "A central question with radiating sticky notes.",
    category: "Thinking",
    build: () => {
      const center = makeShape("ellipse", -110, -55, "What are we solving?", "saffron", 220, 110);
      const notes = [
        makeNote(-430, -280, "Fresh angle\n\nWhat if we inverted the problem?", "moss"),
        makeNote(210, -280, "Constraint\n\nWhat is the smallest useful version?", "sky"),
        makeNote(-430, 150, "Signal\n\nWhat did users actually ask for?", "lilac"),
        makeNote(210, 150, "Risk\n\nWhat would make this fail?", "rose"),
      ];
      const connectors = notes.map((note) =>
        makeConnector(
          { elementId: center.id, anchor: "center" },
          { elementId: note.id, anchor: "center" },
        ),
      );
      return { version: 1, background: "dots", elements: [center, ...notes, ...connectors] };
    },
  },
  {
    id: "research",
    name: "Research board",
    description: "Sources, evidence, questions, and synthesis.",
    category: "Thinking",
    build: () => {
      const frames = [
        makeFrame(-700, -260, "Sources", 640, 420),
        makeFrame(20, -260, "Evidence", 640, 420),
        makeFrame(-700, 220, "Open questions", 640, 420),
        makeFrame(20, 220, "Synthesis", 640, 420),
      ];
      const notes = [
        makeNote(-660, -200, "Add links, clips, and PDFs here.", "sky"),
        makeNote(60, -200, "What supports or challenges the thesis?", "moss"),
        makeNote(-660, 280, "What is still unknown?", "saffron"),
        makeNote(60, 280, "What is the smallest defensible conclusion?", "lilac"),
      ];
      return { version: 1, background: "dots", elements: [...frames, ...notes] };
    },
  },
  {
    id: "architecture",
    name: "Software architecture",
    description: "Services, data stores, clients, and flows.",
    category: "Technical",
    build: () => {
      const client = makeShape("rectangle", -560, 0, "Client\nWeb · Desktop · Mobile", "sky", 220, 110);
      const api = makeShape("rectangle", -260, 0, "API\nAuth · Sync · Search", "saffron", 220, 110);
      const worker = makeShape("rectangle", -260, 180, "Worker\nJobs · AI · Indexing", "lilac", 220, 110);
      const db = makeShape("cylinder", 60, 0, "Postgres\nTenant data", "moss", 220, 120);
      const cache = makeShape("cylinder", 60, 180, "Object storage\nUploads", "rose", 220, 120);
      return {
        version: 1,
        background: "grid",
        elements: [
          client,
          api,
          worker,
          db,
          cache,
          makeConnector({ elementId: client.id, anchor: "right" }, { elementId: api.id, anchor: "left" }),
          makeConnector({ elementId: api.id, anchor: "right" }, { elementId: db.id, anchor: "left" }),
          makeConnector({ elementId: worker.id, anchor: "right" }, { elementId: cache.id, anchor: "left" }),
          makeConnector({ elementId: api.id, anchor: "bottom" }, { elementId: worker.id, anchor: "top" }, "events"),
        ],
      };
    },
  },
  {
    id: "flowchart",
    name: "Flowchart",
    description: "A start, two decisions, and outcomes.",
    category: "Technical",
    build: () => {
      const start = makeShape("ellipse", 0, -260, "Start", "moss", 160, 80);
      const step = makeShape("rectangle", 0, -100, "Do the work", "sky", 200, 90);
      const decision = makeShape("diamond", 0, 60, "Working?", "saffron", 200, 140);
      const yes = makeShape("ellipse", 300, 80, "Ship", "moss", 150, 80);
      const no = makeShape("rectangle", -300, 80, "Iterate", "rose", 180, 80);
      return {
        version: 1,
        background: "dots",
        elements: [
          start,
          step,
          decision,
          yes,
          no,
          makeConnector({ elementId: start.id, anchor: "bottom" }, { elementId: step.id, anchor: "top" }),
          makeConnector({ elementId: step.id, anchor: "bottom" }, { elementId: decision.id, anchor: "top" }),
          makeConnector({ elementId: decision.id, anchor: "right" }, { elementId: yes.id, anchor: "left" }, "yes"),
          makeConnector({ elementId: decision.id, anchor: "left" }, { elementId: no.id, anchor: "right" }, "no"),
          makeConnector({ elementId: no.id, anchor: "top" }, { elementId: step.id, anchor: "left" }),
        ],
      };
    },
  },
  {
    id: "uml",
    name: "UML class sketch",
    description: "Classes with responsibilities and relationships.",
    category: "Technical",
    build: () => {
      const a = makeShape("rectangle", -500, 0, "Workspace\n— id\n— name\n+ invite()\n+ sync()", "sky", 260, 170);
      const b = makeShape("rectangle", -120, 0, "Notebook\n— id\n— title\n+ addPage()", "saffron", 260, 150);
      const c = makeShape("rectangle", 260, 0, "Page\n— id\n— title\n— content\n+ save()", "moss", 260, 170);
      return {
        version: 1,
        background: "grid",
        elements: [
          a,
          b,
          c,
          makeConnector({ elementId: a.id, anchor: "right" }, { elementId: b.id, anchor: "left" }, "1..*"),
          makeConnector({ elementId: b.id, anchor: "right" }, { elementId: c.id, anchor: "left" }, "1..*"),
        ],
      };
    },
  },
  {
    id: "er",
    name: "ER diagram",
    description: "Entities, keys, and cardinality.",
    category: "Technical",
    build: () => {
      const user = makeShape("rectangle", -520, 0, "USER\n— id (PK)\n— email\n— created_at", "sky", 240, 150);
      const ws = makeShape("rectangle", -120, 0, "WORKSPACE\n— id (PK)\n— owner_id (FK)\n— name", "saffron", 260, 150);
      const page = makeShape("rectangle", 300, 0, "PAGE\n— id (PK)\n— workspace_id (FK)\n— title", "moss", 260, 150);
      return {
        version: 1,
        background: "grid",
        elements: [
          user,
          ws,
          page,
          makeConnector({ elementId: user.id, anchor: "right" }, { elementId: ws.id, anchor: "left" }, "owns"),
          makeConnector({ elementId: ws.id, anchor: "right" }, { elementId: page.id, anchor: "left" }, "contains"),
        ],
      };
    },
  },
  {
    id: "learning",
    name: "Learning board",
    description: "Known, learning, and next concepts.",
    category: "Learning",
    build: () => {
      const known = makeFrame(-720, -220, "Known", 560, 400);
      const learning = makeFrame(-80, -220, "Learning", 560, 400);
      const next = makeFrame(560, -220, "Next", 560, 400);
      return {
        version: 1,
        background: "dots",
        elements: [
          known,
          learning,
          next,
          makeNote(-670, -120, "Drag mastered concepts here.", "moss"),
          makeNote(-30, -120, "What are you actively learning?", "saffron"),
          makeNote(610, -120, "What depends on the current topic?", "sky"),
        ],
      };
    },
  },
  {
    id: "presentation",
    name: "Presentation",
    description: "Three widescreen frames for a narrative.",
    category: "Presentation",
    build: () => {
      const frames = [
        makeFrame(0, 0, "1 · Context", 1280, 720),
        makeFrame(1440, 0, "2 · Idea", 1280, 720),
        makeFrame(2880, 0, "3 · Next", 1280, 720),
      ];
      return { version: 1, background: "plain", elements: frames };
    },
  },
];

export function createMindMap(title: string, outline: OutlineItem[]): CanvasDocument {
  const root = makeShape("ellipse", 0, 0, title || "Central idea", "saffron", 300, 110);
  const elements: CanvasDocument["elements"] = [root];
  const stack: Array<{ level: number; id: string }> = [{ level: 0, id: root.id }];
  const items = outline.length
    ? outline
    : [{ id: "empty-1", level: 1, text: "First idea", pos: 0 }];

  items.forEach((item, index) => {
    const level = Math.min(4, Math.max(1, item.level));
    while (stack.length > 1 && (stack[stack.length - 1]?.level ?? 0) >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1] ?? { level: 0, id: root.id };
    const node = makeShape(
      level === 1 ? "rectangle" : "rectangle",
      level * 340,
      index * 110 - Math.floor(items.length / 2) * 55,
      item.text,
      stickyColor(index),
      260,
      72,
    );
    elements.push(node);
    elements.push(
      makeConnector(
        { elementId: parent.id, anchor: "right" },
        { elementId: node.id, anchor: "left" },
      ),
    );
    stack.push({ level, id: node.id });
  });

  return { version: 1, background: "dots", elements };
}

export function createFlowFromOutline(title: string, outline: OutlineItem[]): CanvasDocument {
  const steps = outline.length ? outline : [{ id: "step", level: 1, text: title, pos: 0 }];
  const elements: CanvasDocument["elements"] = [];
  let previous: CanvasShapeElement | null = null;
  steps.forEach((step, index) => {
    const node = makeShape("rectangle", 0, index * 160, step.text, stickyColor(index), 300, 90);
    elements.push(node);
    if (previous) {
      elements.push(
        makeConnector(
          { elementId: previous.id, anchor: "bottom" },
          { elementId: node.id, anchor: "top" },
        ),
      );
    }
    previous = node;
  });
  return { version: 1, background: "dots", elements };
}

export function createConceptMap(title: string, outline: OutlineItem[]): CanvasDocument {
  const center = makeShape("ellipse", 0, 0, title || "Concept", "saffron", 260, 110);
  const elements: CanvasDocument["elements"] = [center];
  const radius = Math.max(280, outline.length * 58);
  outline.forEach((item, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, outline.length) - Math.PI / 2;
    const node = makeNote(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      item.text,
      stickyColor(index),
      200,
      120,
    );
    elements.push(node);
    elements.push(
      makeConnector(
        { elementId: center.id, anchor: "center" },
        { elementId: node.id, anchor: "center" },
      ),
    );
  });
  return { version: 1, background: "dots", elements };
}

export function snap(value: number, grid = 8): number {
  return Math.round(value / grid) * grid;
}

export function elementCenter(element: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

export function connectorPoint(
  endpoint: CanvasConnectorElement["from"],
  elementsById: Map<string, { x: number; y: number; width: number; height: number }>,
): { x: number; y: number } {
  if (endpoint.elementId) {
    const element = elementsById.get(endpoint.elementId);
    if (element) {
      switch (endpoint.anchor) {
        case "top":
          return { x: element.x + element.width / 2, y: element.y };
        case "bottom":
          return { x: element.x + element.width / 2, y: element.y + element.height };
        case "left":
          return { x: element.x, y: element.y + element.height / 2 };
        case "right":
          return { x: element.x + element.width, y: element.y + element.height / 2 };
        default:
          return elementCenter(element);
      }
    }
  }
  return { x: endpoint.x ?? 0, y: endpoint.y ?? 0 };
}

export function canvasBounds(document: CanvasDocument): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const elements = document.elements.filter((element) => element.type !== "connector");
  if (!elements.length) return { x: -200, y: -150, width: 400, height: 300 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
