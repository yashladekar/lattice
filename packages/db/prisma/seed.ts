import { randomUUID } from "node:crypto";

import "varlock/auto-load";

import { createPrismaClient } from "../src/index";

const DEMO_SLUG = "lattice-demo";
const DEMO_NAME = "Lattice demo";

type SeedPage = {
  key: string;
  title: string;
  icon: string;
  notebook: "learning" | "systems";
  sortOrder: number;
  plainText: string;
  links: string[];
  tags: string[];
  content: unknown;
};

const uid = () => randomUUID();

function pageLink(pageId: string, title: string, icon: string) {
  return { type: "pageLink", attrs: { pageId, title, icon } };
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function bullet(text: string) {
  return {
    type: "bulletList",
    content: [{ type: "listItem", content: [paragraph(text)] }],
  };
}

function callout(title: string, emoji: string, text: string) {
  return {
    type: "callout",
    attrs: { title, emoji, color: "saffron" },
    content: [paragraph(text)],
  };
}

const PAGES: SeedPage[] = [
  {
    key: "spaced",
    title: "Spaced repetition",
    icon: "↺",
    notebook: "learning",
    sortOrder: 0,
    links: ["recall", "memory"],
    tags: ["learning", "method"],
    plainText:
      "Spaced repetition. Reviews spread over days beat one long cramming session. The schedule stretches each time you recall successfully, and pulls the card back when you miss it.",
    content: {
      type: "doc",
      content: [
        callout(
          "The core idea",
          "↺",
          "Review something just before you would forget it. Each successful recall buys a longer interval.",
        ),
        heading(2, "Why spacing works"),
        paragraph(
          "Every retrieval strengthens the trace a little and makes the next one easier. Massed practice feels smoother because it stays inside short-term memory, which is exactly why it fades.",
        ),
        paragraph("Two ideas carry most of the effect:"),
        bullet("Active recall does the strengthening."),
        bullet("Spacing decides when the next rep lands."),
        heading(2, "How Lattice schedules cards"),
        paragraph(
          "Cards carry ease, interval, and repetition count. Rating a review adjusts all three, so a card you keep missing returns quickly and one you know well drifts away.",
        ),
        paragraph("Related:"),
        { type: "__related" },
      ],
    },
  },
  {
    key: "recall",
    title: "Active recall",
    icon: "◎",
    notebook: "learning",
    sortOrder: 1,
    links: ["spaced"],
    tags: ["learning"],
    plainText:
      "Active recall means pulling an answer out of memory instead of re-reading it. The effort is what consolidates the memory.",
    content: {
      type: "doc",
      content: [
        heading(2, "Retrieval is the exercise"),
        paragraph(
          "Re-reading feels productive because the page looks familiar. Recall feels harder because the memory is actually being rebuilt, and that effort is what consolidates it.",
        ),
        callout("Practice", "◎", "Close the note and write down what you remember. Then open it and compare."),
        paragraph("Pairs with:"),
        { type: "__related" },
      ],
    },
  },
  {
    key: "memory",
    title: "How memory works",
    icon: "◈",
    notebook: "learning",
    sortOrder: 2,
    links: ["spaced"],
    tags: ["learning"],
    plainText:
      "Memory is reconstructive. Recall rebuilds the trace rather than replaying a recording, and each rebuild can drift.",
    content: {
      type: "doc",
      content: [
        heading(2, "Encoding, storage, retrieval"),
        paragraph(
          "Encoding is what gets in, storage is what stays, and retrieval is what comes back. Most study problems are retrieval problems, not storage problems.",
        ),
        paragraph(
          "Because recall is reconstructive, a memory you never revisit drifts. Reviewing with spacing keeps the reconstruction anchored to the original.",
        ),
        paragraph("See also:"),
        { type: "__related" },
      ],
    },
  },
  {
    key: "systems",
    title: "Systems thinking",
    icon: "◇",
    notebook: "systems",
    sortOrder: 0,
    links: ["loops"],
    tags: ["systems"],
    plainText:
      "Systems thinking looks at wholes, relationships, and feedback instead of isolated parts.",
    content: {
      type: "doc",
      content: [
        heading(2, "Start with relationships"),
        paragraph(
          "A system is more than its parts. Behaviour comes from how the parts interact, which is why the same components in a different arrangement behave differently.",
        ),
        bullet("Stocks are what accumulates."),
        bullet("Flows are what changes stocks."),
        bullet("Loops are what make behaviour surprising."),
        paragraph("Related:"),
        { type: "__related" },
      ],
    },
  },
  {
    key: "loops",
    title: "Feedback loops",
    icon: "∞",
    notebook: "systems",
    sortOrder: 1,
    links: ["systems"],
    tags: ["systems", "method"],
    plainText:
      "Feedback loops are outputs that circle back as inputs. Reinforcing loops amplify, balancing loops stabilise.",
    content: {
      type: "doc",
      content: [
        heading(2, "Two shapes"),
        bullet("Reinforcing: change feeds more change, like compounding."),
        bullet("Balancing: change triggers a correction, like a thermostat."),
        paragraph(
          "Most surprising system behaviour is a loop that was invisible in the diagram of parts.",
        ),
        callout("Try this", "∞", "Sketch one loop from your own week: what output comes back as an input?"),
        paragraph("Related:"),
        { type: "__related" },
      ],
    },
  },
];

const TOPICS = [
  {
    key: "topic-learning",
    title: "Learning science",
    description: "How practice, spacing, and retrieval shape durable memory.",
    color: "#2f6b4f",
    targets: ["spaced", "recall", "memory"],
  },
  {
    key: "topic-systems",
    title: "Systems",
    description: "Wholes, feedback, and the behaviour that emerges between parts.",
    color: "#4a6fa5",
    targets: ["systems", "loops"],
  },
];

async function resetWorkspace(workspaceId: string, db: ReturnType<typeof createPrismaClient>) {
  await db.collabDocument.deleteMany({ where: { workspaceId } });
  await db.notification.deleteMany({ where: { workspaceId } });
  await db.auditLog.deleteMany({ where: { workspaceId } });
  await db.shareLink.deleteMany({ where: { workspaceId } });
  await db.resourcePermission.deleteMany({ where: { workspaceId } });
  await db.aiThread.deleteMany({ where: { workspaceId } });
  await db.syncConflict.deleteMany({ where: { workspaceId } });
  await db.syncOp.deleteMany({ where: { workspaceId } });
  await db.syncChange.deleteMany({ where: { workspaceId } });
  await db.comment.deleteMany({ where: { workspaceId } });
  await db.pageTag.deleteMany({ where: { page: { workspaceId } } });
  await db.reviewLog.deleteMany({ where: { workspaceId } });
  await db.flashcard.deleteMany({ where: { workspaceId } });
  await db.deck.deleteMany({ where: { workspaceId } });
  await db.knowledgeEdge.deleteMany({ where: { workspaceId } });
  await db.knowledgeNode.deleteMany({ where: { workspaceId } });
  await db.pageVersion.deleteMany({ where: { workspaceId } });
  await db.pageDocument.deleteMany({ where: { workspaceId } });
  await db.canvasVersion.deleteMany({ where: { workspaceId } });
  await db.attachment.deleteMany({ where: { workspaceId } });
  await db.suggestedEdit.deleteMany({ where: { workspaceId } });
  await db.objectType.deleteMany({ where: { workspaceId } });
  await db.ssoConnection.deleteMany({ where: { workspaceId } });
  await db.ssoLoginState.deleteMany({ where: { workspaceId } });
  await db.legalHold.deleteMany({ where: { workspaceId } });
  await db.capture.deleteMany({ where: { workspaceId } });
  await db.template.deleteMany({ where: { workspaceId } });
  await db.page.deleteMany({ where: { workspaceId } });
  await db.canvas.deleteMany({ where: { workspaceId } });
  await db.notebook.deleteMany({ where: { workspaceId } });
  await db.workspaceInvite.deleteMany({ where: { workspaceId } });
  await db.workspaceMember.deleteMany({ where: { workspaceId } });
  await db.workspace.delete({ where: { id: workspaceId } });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Run the seed from packages/db so varlock can load it.");
  }
  const db = createPrismaClient({ DATABASE_URL: databaseUrl });
  const reset = process.argv.includes("--reset");
  const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
  const email = emailArg?.slice("--email=".length);

  const user = email
    ? await db.user.findFirst({ where: { email } })
    : await db.user.findFirst({ orderBy: { createdAt: "asc" } });

  if (!user) {
    throw new Error(
      "No user found to own the demo workspace. Sign up first, or pass --email=<address>.",
    );
  }

  const existing = await db.workspace.findFirst({ where: { slug: DEMO_SLUG } });
  if (existing) {
    if (!reset) {
      console.log(`"${DEMO_NAME}" already exists (slug ${DEMO_SLUG}). Re-run with --reset to rebuild it.`);
      return;
    }
    await resetWorkspace(existing.id, db);
    console.log(`Removed the previous "${DEMO_NAME}" workspace.`);
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const workspace = await db.workspace.create({
    data: {
      id: uid(),
      name: DEMO_NAME,
      slug: DEMO_SLUG,
      type: "PERSONAL",
      description: "Seeded demo content: linked notes, topics, a whiteboard, and a deck.",
      icon: "✦",
      accent: "#e07a2e",
      ownerId: user.id,
      syncVersion: 1,
    },
  });

  await db.workspaceMember.create({
    data: {
      id: uid(),
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  const notebooks = await Promise.all(
    [
      { key: "learning", name: "Learning lab", icon: "◎", color: "#2f6b4f" },
      { key: "systems", name: "Systems notes", icon: "◇", color: "#4a6fa5" },
    ].map(async (notebook) => {
      const created = await db.notebook.create({
        data: {
          id: uid(),
          workspaceId: workspace.id,
          name: notebook.name,
          icon: notebook.icon,
          color: notebook.color,
          visibility: "WORKSPACE",
          createdById: user.id,
        },
      });
      return [notebook.key, created] as const;
    }),
  );
  const notebookByKey = new Map(notebooks);

  const pageIdByKey = new Map<string, string>();
  for (const page of PAGES) pageIdByKey.set(page.key, uid());

  for (const page of PAGES) {
    const id = pageIdByKey.get(page.key)!;
    const notebook = notebookByKey.get(page.notebook)!;
    await db.page.create({
      data: {
        id,
        workspaceId: workspace.id,
        notebookId: notebook.id,
        title: page.title,
        icon: page.icon,
        type: "DOCUMENT",
        visibility: "WORKSPACE",
        sortOrder: page.sortOrder,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const content = structuredClone(page.content) as {
      content: Array<Record<string, unknown> & { type?: string }>;
    };
    content.content = content.content.map((node) => {
      if (node.type !== "__related") return node;
      const items = page.links.map((key) => {
        const target = PAGES.find((candidate) => candidate.key === key)!;
        return {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [pageLink(pageIdByKey.get(key)!, target.title, target.icon)],
            },
          ],
        };
      });
      return { type: "bulletList", content: items };
    });
    await db.pageDocument.create({
      data: {
        pageId: id,
        workspaceId: workspace.id,
        content,
        plainText: page.plainText,
      },
    });
    await db.knowledgeNode.create({
      data: {
        id,
        workspaceId: workspace.id,
        kind: "PAGE",
        title: page.title,
        pageId: id,
        createdById: user.id,
      },
    });
  }

  const tagIdByName = new Map<string, string>();
  for (const name of ["learning", "systems", "method"]) {
    const tag = await db.tag.create({
      data: {
        id: uid(),
        workspaceId: workspace.id,
        name,
        color: name === "learning" ? "#2f6b4f" : name === "systems" ? "#4a6fa5" : "#e07a2e",
      },
    });
    tagIdByName.set(name, tag.id);
  }
  for (const page of PAGES) {
    for (const tagName of page.tags) {
      await db.pageTag.create({
        data: {
          id: uid(),
          pageId: pageIdByKey.get(page.key)!,
          tagId: tagIdByName.get(tagName)!,
          source: "USER",
        },
      });
    }
  }

  // Page-link edges use the same id and tuple the server recomputes on save,
  // so a later edit reconciles them instead of duplicating.
  for (const page of PAGES) {
    for (const targetKey of page.links) {
      const source = pageIdByKey.get(page.key)!;
      const target = pageIdByKey.get(targetKey)!;
      await db.knowledgeEdge.create({
        data: {
          id: `link:${source}:${target}`,
          workspaceId: workspace.id,
          sourceNodeId: source,
          targetNodeId: target,
          relationType: "REFERENCES",
          origin: "PAGE_LINK",
          createdById: user.id,
        },
      });
    }
  }

  for (const topic of TOPICS) {
    await db.knowledgeNode.create({
      data: {
        id: topic.key,
        workspaceId: workspace.id,
        kind: "TOPIC",
        title: topic.title,
        description: topic.description,
        color: topic.color,
        createdById: user.id,
      },
    });
    for (const targetKey of topic.targets) {
      const target = pageIdByKey.get(targetKey)!;
      await db.knowledgeEdge.create({
        data: {
          id: uid(),
          workspaceId: workspace.id,
          sourceNodeId: topic.key,
          targetNodeId: target,
          relationType: "RELATED_TO",
          origin: "MANUAL",
          weight: 1,
          createdById: user.id,
        },
      });
    }
  }

  const canvas = await db.canvas.create({
    data: {
      id: uid(),
      workspaceId: workspace.id,
      notebookId: notebookByKey.get("learning")!.id,
      title: "Learning map",
      icon: "◫",
      rev: 1,
      createdById: user.id,
      updatedById: user.id,
      data: {
        version: 1,
        background: "dots",
        elements: [
          {
            id: "frame-review",
            type: "frame",
            x: 40,
            y: 40,
            width: 960,
            height: 640,
            title: "The review loop",
            color: "paper",
          },
          {
            id: "note-retrieval",
            type: "note",
            x: 120,
            y: 130,
            width: 230,
            height: 150,
            text: "Retrieval beats re-reading. Close the note and answer from memory.",
            color: "saffron",
          },
          {
            id: "note-spacing",
            type: "note",
            x: 420,
            y: 130,
            width: 230,
            height: 150,
            text: "Space the sessions. Each successful recall buys a longer interval.",
            color: "moss",
          },
          {
            id: "shape-practice",
            type: "shape",
            shape: "ellipse",
            x: 730,
            y: 130,
            width: 210,
            height: 150,
            text: "Practice",
            color: "sky",
          },
          {
            id: "shape-memory",
            type: "shape",
            shape: "rectangle",
            x: 420,
            y: 400,
            width: 240,
            height: 140,
            text: "Long-term memory",
            color: "lilac",
          },
          {
            id: "card-spaced",
            type: "page",
            x: 120,
            y: 400,
            width: 240,
            height: 150,
            pageId: pageIdByKey.get("spaced")!,
            variant: "card",
            color: "paper",
          },
          {
            id: "card-memory",
            type: "page",
            x: 730,
            y: 400,
            width: 240,
            height: 150,
            pageId: pageIdByKey.get("memory")!,
            variant: "card",
            color: "paper",
          },
          {
            id: "connector-practice",
            type: "connector",
            from: { elementId: "note-retrieval", anchor: "right" },
            to: { elementId: "shape-practice", anchor: "left" },
            arrowEnd: true,
            label: "builds",
          },
          {
            id: "connector-memory",
            type: "connector",
            from: { elementId: "shape-practice", anchor: "bottom" },
            to: { elementId: "shape-memory", anchor: "right" },
            arrowEnd: true,
          },
          {
            id: "connector-explains",
            type: "connector",
            from: { elementId: "card-memory", anchor: "left" },
            to: { elementId: "card-spaced", anchor: "right" },
            arrowEnd: true,
            style: "dashed",
            label: "explains",
          },
        ],
      },
    },
  });

  await db.knowledgeNode.create({
    data: {
      id: canvas.id,
      workspaceId: workspace.id,
      kind: "CANVAS",
      title: canvas.title,
      canvasId: canvas.id,
      createdById: user.id,
    },
  });

  const deck = await db.deck.create({
    data: {
      id: uid(),
      workspaceId: workspace.id,
      notebookId: notebookByKey.get("learning")!.id,
      name: "Core learning concepts",
      description: "Six cards seeded from the learning notes.",
      color: "#2f6b4f",
    },
  });

  const cards: Array<{ front: string; back: string; pageKey: string; dueIn: number }> = [
    {
      front: "What is active recall?",
      back: "Retrieving an answer from memory instead of re-reading it. The effort of retrieval is what consolidates the memory.",
      pageKey: "recall",
      dueIn: 0,
    },
    {
      front: "Why does spacing beat cramming?",
      back: "Reviews spread over time force partly-forgotten retrieval, which strengthens the trace more than massed repetition.",
      pageKey: "spaced",
      dueIn: 0,
    },
    {
      front: "What do ease, interval, and reps control?",
      back: "They decide when a card is due next. SM-2 stretches the interval after a good rating and pulls it back after a miss.",
      pageKey: "spaced",
      dueIn: 0,
    },
    {
      front: "Why is memory reconstructive?",
      back: "Recall rebuilds the trace each time rather than replaying a recording, so an unreviewed memory drifts.",
      pageKey: "memory",
      dueIn: 1,
    },
    {
      front: "What is a reinforcing feedback loop?",
      back: "A loop where change feeds more change, like compounding. Balancing loops do the opposite and stabilise.",
      pageKey: "loops",
      dueIn: 2,
    },
    {
      front: "What are the three parts of memory?",
      back: "Encoding (what gets in), storage (what stays), and retrieval (what comes back).",
      pageKey: "memory",
      dueIn: 3,
    },
  ];

  for (const card of cards) {
    await db.flashcard.create({
      data: {
        id: uid(),
        workspaceId: workspace.id,
        deckId: deck.id,
        pageId: pageIdByKey.get(card.pageKey)!,
        front: card.front,
        back: card.back,
        source: "SEED",
        dueAt: new Date(now + card.dueIn * day),
      },
    });
  }

  await db.capture.create({
    data: {
      id: uid(),
      workspaceId: workspace.id,
      type: "NOTE",
      title: "Idea: test myself before opening the note",
      content:
        "Write the question first, then open the source and grade the answer. Turning reading into a quiz is the cheapest form of active recall.",
      source: "seed",
      status: "INBOX",
      createdById: user.id,
    },
  });

  const readingType = await db.objectType.create({
    data: {
      id: uid(),
      workspaceId: workspace.id,
      name: "Reading",
      icon: "◈",
      color: "#4a6fa5",
      description: "Typed fields for a note you are reading through",
      properties: [
        {
          key: "status",
          label: "Status",
          type: "select",
          options: ["To read", "Reading", "Done"],
        },
        { key: "rating", label: "Rating", type: "number" },
        { key: "finished", label: "Finished", type: "checkbox" },
      ],
    },
  });
  await db.page.update({
    where: { id: pageIdByKey.get(PAGES[0]!.key)! },
    data: {
      properties: { __type: readingType.id, status: "Reading", rating: 4, finished: false },
    },
  });

  console.log(`Seeded "${DEMO_NAME}" for ${user.email}.`);
  console.log("  · 5 linked pages across 2 notebooks");
  console.log("  · 2 topics with manual relations, 3 tags");
  console.log(`  · 1 whiteboard ("${canvas.title}")`);
  console.log(`  · 1 deck ("${deck.name}") with ${cards.length} due-spread cards`);
  console.log("  · 1 capture waiting in the inbox");
  console.log(`  · 1 object type ("${readingType.name}") assigned to the first note`);
}

main()
  .then(async () => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
