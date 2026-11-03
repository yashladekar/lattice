import type { TipTapDoc, TipTapNode } from "./types";

export interface PageTemplateDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "Writing" | "Work" | "Research" | "Learning" | "Engineering" | "Personal";
  content: TipTapDoc;
  properties?: Record<string, unknown>;
}

const text = (value: string): TipTapNode => ({ type: "text", text: value });

const paragraph = (...content: Array<string | TipTapNode>): TipTapNode => {
  const nodes = content.map((item) => (typeof item === "string" ? text(item) : item));
  return {
    type: "paragraph",
    ...(nodes.length ? { content: nodes } : {}),
  };
};

const heading = (level: number, value: string): TipTapNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

const callout = (title: string, body: string, emoji = "✦", color = "saffron"): TipTapNode => ({
  type: "callout",
  attrs: { title, emoji, color },
  content: [paragraph(text(body))],
});

const bulletList = (...items: string[]): TipTapNode => {
  if (!items.length) return paragraph();
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(text(item))],
    })),
  };
};

const taskList = (...items: Array<{ text: string; checked?: boolean }>): TipTapNode => {
  if (!items.length) return paragraph();
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: item.checked ?? false },
      content: [paragraph(text(item.text))],
    })),
  };
};

const divider = (): TipTapNode => ({ type: "horizontalRule" });

export const PAGE_TEMPLATES: PageTemplateDefinition[] = [
  {
    id: "blank",
    name: "Blank page",
    description: "Start with an empty page.",
    icon: "◇",
    category: "Writing",
    content: { type: "doc", content: [paragraph()] },
  },
  {
    id: "meeting",
    name: "Meeting notes",
    description: "Agenda, decisions, action items, and open questions.",
    icon: "◷",
    category: "Work",
    content: {
      type: "doc",
      content: [
        heading(2, "Agenda"),
        bulletList("Topic one", "Topic two"),
        heading(2, "Decisions"),
        callout("Decision log", "Record the decision, the reasoning, and who owns it.", "✓", "moss"),
        bulletList(),
        heading(2, "Action items"),
        taskList(
          { text: "Owner — action — due date" },
          { text: "Follow up with the team" },
        ),
        heading(2, "Open questions"),
        bulletList("What still needs an answer?"),
        heading(2, "Notes"),
        paragraph("Capture the useful details while they are fresh."),
      ],
    },
    properties: { date: new Date().toISOString().slice(0, 10), status: "active" },
  },
  {
    id: "adr",
    name: "Architecture decision record",
    description: "Context, decision, alternatives, and consequences.",
    icon: "⌘",
    category: "Engineering",
    content: {
      type: "doc",
      content: [
        callout(
          "ADR",
          "A lightweight record of a consequential technical decision. Keep it short, dated, and honest.",
          "⚙",
          "sky",
        ),
        heading(2, "Status"),
        paragraph(text("Proposed")),
        heading(2, "Context"),
        paragraph("What forces are at play? What constraints matter?"),
        heading(2, "Decision"),
        paragraph("What are we doing, precisely?"),
        heading(2, "Alternatives considered"),
        bulletList("Option A — trade-off", "Option B — trade-off"),
        heading(2, "Consequences"),
        bulletList("What gets easier?", "What gets harder?", "What will we revisit?"),
        heading(2, "References"),
        bulletList("Link related pages and external docs"),
      ],
    },
  },
  {
    id: "research",
    name: "Research brief",
    description: "Question, sources, evidence, and synthesis.",
    icon: "◉",
    category: "Research",
    content: {
      type: "doc",
      content: [
        heading(2, "Research question"),
        paragraph("What exactly are we trying to understand?"),
        heading(2, "Why it matters"),
        paragraph("What decision or understanding depends on this?"),
        heading(2, "Sources"),
        bulletList("Source — link — why it is credible"),
        heading(2, "Evidence"),
        paragraph("Capture quotes and observations with links."),
        heading(2, "Counter-evidence"),
        paragraph("What challenges the emerging view?"),
        heading(2, "Synthesis"),
        callout("Working conclusion", "Write the smallest defensible claim.", "✦", "saffron"),
        heading(2, "Next questions"),
        bulletList("What would change our mind?"),
      ],
    },
  },
  {
    id: "project",
    name: "Project brief",
    description: "Outcome, scope, milestones, risks, and links.",
    icon: "◈",
    category: "Work",
    content: {
      type: "doc",
      content: [
        callout("North star", "Describe the outcome in one sentence a teammate could repeat.", "◎", "saffron"),
        heading(2, "Why now"),
        paragraph("What changes if this succeeds?"),
        heading(2, "Scope"),
        bulletList("In scope", "Out of scope"),
        heading(2, "Milestones"),
        taskList(
          { text: "Milestone one — date" },
          { text: "Milestone two — date" },
          { text: "Milestone three — date" },
        ),
        heading(2, "Risks"),
        bulletList("Risk — mitigation"),
        heading(2, "Open decisions"),
        bulletList("Decision needed — owner — deadline"),
      ],
    },
  },
  {
    id: "weekly",
    name: "Weekly review",
    description: "Wins, friction, learning, and next week.",
    icon: "◐",
    category: "Personal",
    content: {
      type: "doc",
      content: [
        heading(2, "What moved forward?"),
        bulletList(),
        heading(2, "What created friction?"),
        bulletList(),
        heading(2, "What did I learn?"),
        paragraph("Turn anything reusable into its own note."),
        heading(2, "Next week"),
        taskList(
          { text: "One meaningful outcome" },
          { text: "One relationship to invest in" },
          { text: "One thing to remove" },
        ),
        divider(),
        callout("Review prompt", "What would future-you thank present-you for?", "↺", "lilac"),
      ],
    },
  },
  {
    id: "learning",
    name: "Learning note",
    description: "Concepts, examples, connections, and recall prompts.",
    icon: "◒",
    category: "Learning",
    content: {
      type: "doc",
      content: [
        callout(
          "How to use this note",
          "Write it in your own words. Add a concrete example. Then turn the key ideas into flashcards.",
          "✧",
          "moss",
        ),
        heading(2, "Core idea"),
        paragraph("Explain the concept as if teaching a smart peer."),
        heading(2, "Why it works"),
        paragraph("Mechanism or causal explanation."),
        heading(2, "Example"),
        paragraph("A concrete case, ideally from your own work."),
        heading(2, "Connections"),
        bulletList("Related concept", "Prerequisite", "Contrasting idea"),
        heading(2, "Recall prompts"),
        bulletList("What is it?", "When would you use it?", "What does it replace?"),
      ],
    },
  },
  {
    id: "decision",
    name: "Decision log",
    description: "Track decisions, owners, and revisit dates.",
    icon: "◇",
    category: "Work",
    content: {
      type: "doc",
      content: [
        heading(2, "Decisions"),
        {
          type: "database",
          attrs: {
            title: "Decision log",
            view: "table",
            fields: [
              { id: "decision", name: "Decision", type: "text" },
              { id: "owner", name: "Owner", type: "text" },
              { id: "status", name: "Status", type: "select", options: ["Proposed", "Decided", "Revisit"] },
              {
                id: "date",
                name: "Date",
                type: "date",
              },
            ],
            rows: [
              {
                id: "row-1",
                values: {
                  decision: "First decision",
                  owner: "",
                  status: "Proposed",
                  date: new Date().toISOString().slice(0, 10),
                },
              },
            ],
          },
        },
      ],
    },
  },
  {
    id: "troubleshooting",
    name: "Troubleshooting guide",
    description: "Symptom, diagnosis, fix, and prevention.",
    icon: "⌁",
    category: "Engineering",
    content: {
      type: "doc",
      content: [
        heading(2, "Symptom"),
        paragraph("What does the failure look like?"),
        heading(2, "Impact"),
        bulletList("Who is affected", "What is blocked", "Severity"),
        heading(2, "Diagnosis"),
        paragraph("Commands, logs, and the shortest reproduction."),
        heading(2, "Fix"),
        paragraph("Steps to resolve, including rollback."),
        heading(2, "Prevention"),
        taskList({ text: "Add monitoring or a regression test" }),
      ],
    },
  },
];

export function templateById(id: string): PageTemplateDefinition {
  return PAGE_TEMPLATES.find((template) => template.id === id) ?? PAGE_TEMPLATES[0]!;
}
