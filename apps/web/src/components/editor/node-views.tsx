"use client";

import {
  findBlock,
  type TipTapNode,
} from "@notes-learning/domain";
import { cn } from "@notes-learning/ui/lib/utils";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  GalleryHorizontal,
  LayoutList,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { usePage, usePageDocument } from "@/hooks/use-local-data";
import { appRouteObject } from "@/lib/navigation";

import { ReadOnlyDocument } from "./read-only-document";

export function PageLinkView({ node }: NodeViewProps) {
  const router = useRouter();
  const pageId = typeof node.attrs.pageId === "string" ? node.attrs.pageId : "";
  const page = usePage(pageId || null);
  const title =
    page?.title ?? (typeof node.attrs.title === "string" ? node.attrs.title : "Untitled");
  const icon = page?.icon ?? (typeof node.attrs.icon === "string" ? node.attrs.icon : "◇");
  const missing = !page;
  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        type="button"
        onClick={() => pageId && router.push(appRouteObject({ view: "page", id: pageId }))}
        className={cn(
          "mx-0.5 inline-flex max-w-full items-center gap-1 border-b border-primary/30 align-baseline text-primary",
          missing && "border-destructive/30 text-muted-foreground",
        )}
        title={missing ? "This page is missing or private" : title}
      >
        <span className="text-[0.72em]">{icon}</span>
        <span className="truncate">{title}</span>
      </button>
    </NodeViewWrapper>
  );
}

export function PageEmbedView({ node, selected }: NodeViewProps) {
  const router = useRouter();
  const pageId = typeof node.attrs.pageId === "string" ? node.attrs.pageId : "";
  const page = usePage(pageId || null);
  const document = usePageDocument(pageId || null);
  const excerpt = document?.plainText.slice(0, 280) ?? "";
  return (
    <NodeViewWrapper
      className={cn(
        "my-4 rounded-xl border border-border/80 bg-card/60 p-4 transition-colors",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-sm">
          {page?.icon ?? "◇"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium">{page?.title ?? "Missing page"}</span>
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
              embedded
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-[10.5px] leading-relaxed text-muted-foreground">
            {excerpt || "This page has no text yet."}
          </p>
          <button
            type="button"
            onClick={() => pageId && router.push(appRouteObject({ view: "page", id: pageId }))}
            className="mt-2 inline-flex items-center gap-1 text-[9px] text-primary hover:underline"
          >
            Open page <ArrowUpRight className="size-2.5" />
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export function LiveBlockView({ node, selected }: NodeViewProps) {
  const pageId = typeof node.attrs.pageId === "string" ? node.attrs.pageId : "";
  const blockId = typeof node.attrs.blockId === "string" ? node.attrs.blockId : "";
  const page = usePage(pageId || null);
  const document = usePageDocument(pageId || null);
  const block = document ? findBlock(document.content, blockId) : null;
  return (
    <NodeViewWrapper
      className={cn(
        "my-4 rounded-xl border border-dashed border-border/80 bg-muted/15 p-3",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[8px] uppercase tracking-[0.15em] text-muted-foreground">
          Live from {page?.title ?? "a page"}
        </span>
        <span className="inline-flex size-4 items-center justify-center rounded-full border border-moss/40 text-[8px] text-moss">
          ↺
        </span>
      </div>
      {block ? (
        <ReadOnlyDocument
          doc={{ type: "doc", content: [block as TipTapNode] }}
          compact
          className="[&_.tiptap]:min-h-0"
        />
      ) : (
        <p className="text-[10px] text-muted-foreground">
          This block was removed from its source page.
        </p>
      )}
    </NodeViewWrapper>
  );
}

export function BookmarkView({ node, selected }: NodeViewProps) {
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : url;
  const description = typeof node.attrs.description === "string" ? node.attrs.description : "";
  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  return (
    <NodeViewWrapper
      className={cn(
        "my-4 overflow-hidden rounded-xl border border-border/80 bg-card/55",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-start gap-3 p-4 no-underline"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-saffron">
          <Bookmark className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">{title}</span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground/50" />
          </span>
          <span className="mt-1 line-clamp-2 block text-[10.5px] leading-relaxed text-muted-foreground">
            {description || url}
          </span>
          <span className="mt-1 block text-[9px] text-muted-foreground/60">{hostname}</span>
        </span>
      </a>
    </NodeViewWrapper>
  );
}

interface DatabaseField {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  options?: string[];
}

interface DatabaseRow {
  id: string;
  values: Record<string, string | number | boolean>;
}

type DatabaseView = "table" | "list" | "board" | "gallery" | "calendar";

function normalizeFields(value: unknown): DatabaseField[] {
  if (Array.isArray(value)) {
    return value
      .filter((field): field is Record<string, unknown> => typeof field === "object" && field !== null)
      .map((field, index) => ({
        id: typeof field.id === "string" ? field.id : `field-${index}`,
        name: typeof field.name === "string" ? field.name : `Field ${index + 1}`,
        type:
          field.type === "number" ||
          field.type === "date" ||
          field.type === "select" ||
          field.type === "checkbox"
            ? field.type
            : "text",
        options: Array.isArray(field.options)
          ? field.options.filter((option): option is string => typeof option === "string")
          : undefined,
      }));
  }
  return [
    { id: "name", name: "Name", type: "text" },
    { id: "status", name: "Status", type: "select", options: ["Todo", "Doing", "Done"] },
    { id: "date", name: "Date", type: "date" },
  ];
}

function normalizeRows(value: unknown): DatabaseRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row, index) => ({
      id: typeof row.id === "string" ? row.id : `row-${index}`,
      values:
        typeof row.values === "object" && row.values !== null
          ? (row.values as Record<string, string | number | boolean>)
          : {},
    }));
}

function cellValue(row: DatabaseRow, fieldId: string): string {
  const value = row.values[fieldId];
  return value === undefined || value === null ? "" : String(value);
}

export function DatabaseNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const fields = useMemo(() => normalizeFields(node.attrs.fields), [node.attrs.fields]);
  const rows = useMemo(() => normalizeRows(node.attrs.rows), [node.attrs.rows]);
  const savedView = typeof node.attrs.view === "string" ? node.attrs.view : "table";
  const [view, setView] = useState<DatabaseView>(
    ["table", "list", "board", "gallery", "calendar"].includes(savedView)
      ? (savedView as DatabaseView)
      : "table",
  );
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "Database";

  const commit = (nextFields: DatabaseField[], nextRows: DatabaseRow[], nextView = view) => {
    updateAttributes({ fields: nextFields, rows: nextRows, view: nextView, title });
  };

  const setCell = (rowId: string, field: DatabaseField, value: string | number | boolean) => {
    const nextRows = rows.map((row) =>
      row.id === rowId ? { ...row, values: { ...row.values, [field.id]: value } } : row,
    );
    commit(fields, nextRows);
  };

  const addRow = (overrides?: Record<string, string | number | boolean>) => {
    const next: DatabaseRow = {
      id: `row_${Date.now().toString(36)}`,
      values: {
        ...(fields[0] ? { [fields[0].id]: "New item" } : {}),
        ...overrides,
      },
    };
    commit(fields, [...rows, next]);
  };

  const removeRow = (rowId: string) => {
    commit(fields, rows.filter((row) => row.id !== rowId));
  };

  const addField = () => {
    const field: DatabaseField = {
      id: `field_${Date.now().toString(36)}`,
      name: `Field ${fields.length + 1}`,
      type: "text",
    };
    commit([...fields, field], rows);
  };

  const switchView = (next: DatabaseView) => {
    setView(next);
    commit(fields, rows, next);
  };

  const selectField = fields.find((field) => field.type === "select");
  const dateField = fields.find((field) => field.type === "date");
  const titleField = fields[0];

  const renderCellInput = (row: DatabaseRow, field: DatabaseField) => {
    const value = cellValue(row, field.id);
    if (field.type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={row.values[field.id] === true}
          onChange={(event) => setCell(row.id, field, event.target.checked)}
          className="size-3.5 accent-[var(--moss)]"
        />
      );
    }
    if (field.type === "select") {
      return (
        <select
          value={value}
          onChange={(event) => setCell(row.id, field, event.target.value)}
          className="h-6 w-full rounded border border-transparent bg-transparent px-1 text-[10px] outline-none hover:border-border focus:border-ring"
        >
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        value={value}
        onChange={(event) =>
          setCell(
            row.id,
            field,
            field.type === "number" ? Number(event.target.value) : event.target.value,
          )
        }
        className="h-6 w-full rounded border border-transparent bg-transparent px-1 text-[10px] outline-none hover:border-border focus:border-ring"
        placeholder={field.type === "date" ? "" : "Empty"}
      />
    );
  };

  const viewButtons: Array<{ id: DatabaseView; icon: typeof Table2; label: string }> = [
    { id: "table", icon: Table2, label: "Table" },
    { id: "list", icon: LayoutList, label: "List" },
    { id: "board", icon: ChevronRight, label: "Board" },
    { id: "gallery", icon: GalleryHorizontal, label: "Gallery" },
    { id: "calendar", icon: CalendarDays, label: "Calendar" },
  ];

  return (
    <NodeViewWrapper
      className={cn(
        "my-5 overflow-hidden rounded-xl border border-border/80 bg-card/40",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="mr-2 text-[11px] font-medium">{title}</span>
          {viewButtons.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.label}
              onClick={() => switchView(entry.id)}
              className={cn(
                "grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
                view === entry.id && "bg-muted text-foreground",
              )}
            >
              <entry.icon className="size-3" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[9px] text-muted-foreground">{rows.length} rows</span>
          <button
            type="button"
            onClick={addField}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Add field"
          >
            <Plus className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => addRow()}
            className="inline-flex h-6 items-center gap-1 rounded bg-foreground px-2 text-[9px] text-background hover:opacity-85"
          >
            <Plus className="size-2.5" /> New row
          </button>
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/60 bg-muted/25">
                {fields.map((field) => (
                  <th key={field.id} className="px-2 py-1.5 text-[9px] font-medium text-muted-foreground">
                    {field.name}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/40 last:border-0">
                  {fields.map((field) => (
                    <td key={field.id} className="px-1.5 py-1 align-middle">
                      {renderCellInput(row, field)}
                    </td>
                  ))}
                  <td className="px-1">
                    <button
                      type="button"
                      aria-label="Delete row"
                      onClick={() => removeRow(row.id)}
                      className="grid size-5 place-items-center rounded text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={fields.length + 1} className="px-3 py-6 text-center text-[10px] text-muted-foreground">
                    No rows yet. Add one to start structuring this page.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : view === "list" ? (
        <div className="divide-y divide-border/40">
          {rows.map((row) => (
            <div key={row.id} className="group flex items-start gap-3 px-3 py-2 hover:bg-muted/20">
              <span className="mt-0.5 text-[11px]">{cellValue(row, titleField?.id ?? "") || "Untitled"}</span>
              <div className="ml-auto flex flex-wrap justify-end gap-2 text-[9px] text-muted-foreground">
                {fields.slice(1, 4).map((field) => (
                  <span key={field.id} className="rounded border border-border/60 px-1.5 py-0.5">
                    {field.name}: {cellValue(row, field.id) || "—"}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete row"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : view === "board" && selectField ? (
        <div className="flex gap-2 overflow-x-auto p-2">
          {["Unassigned", ...(selectField.options ?? [])].map((option) => {
            const group = rows.filter((row) => {
              const value = cellValue(row, selectField.id);
              return option === "Unassigned" ? !value : value === option;
            });
            return (
              <div key={option} className="w-48 shrink-0 rounded-lg bg-muted/25 p-2">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-[9px] font-medium">{option}</span>
                  <span className="text-[8px] text-muted-foreground">{group.length}</span>
                </div>
                <div className="space-y-1">
                  {group.map((row) => (
                    <div key={row.id} className="rounded-md border border-border/60 bg-card px-2 py-1.5">
                      <div className="text-[10px]">{cellValue(row, titleField?.id ?? "") || "Untitled"}</div>
                      {dateField ? (
                        <div className="mt-0.5 text-[8px] text-muted-foreground">{cellValue(row, dateField.id)}</div>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      addRow({
                        [selectField.id]: option === "Unassigned" ? "" : option,
                      })
                    }
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-[8px] text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="size-2.5" /> Add card
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : view === "gallery" ? (
        <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border/60 bg-card p-2.5">
              <div className="text-[10px] font-medium">{cellValue(row, titleField?.id ?? "") || "Untitled"}</div>
              <div className="mt-1 space-y-0.5">
                {fields.slice(1, 4).map((field) => (
                  <div key={field.id} className="flex items-center justify-between text-[8px] text-muted-foreground">
                    <span>{field.name}</span>
                    <span>{cellValue(row, field.id) || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : view === "calendar" && dateField ? (
        <CalendarView rows={rows} dateField={dateField} titleField={titleField} />
      ) : (
        <div className="px-3 py-6 text-center text-[10px] text-muted-foreground">
          Add a select or date field to use this view.
        </div>
      )}
    </NodeViewWrapper>
  );
}

function CalendarView({
  rows,
  dateField,
  titleField,
}: {
  rows: DatabaseRow[];
  dateField: DatabaseField;
  titleField?: DatabaseField;
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const offset = firstDay.getDay();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= days ? day : null;
  });
  const rowsByDay = new Map<number, DatabaseRow[]>();
  for (const row of rows) {
    const date = new Date(cellValue(row, dateField.id));
    if (Number.isNaN(date.getTime())) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    const list = rowsByDay.get(date.getDate()) ?? [];
    list.push(row);
    rowsByDay.set(date.getDate(), list);
  }
  return (
    <div className="p-2">
      <div className="mb-1 text-[9px] font-medium text-muted-foreground">
        {now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border/60 bg-border/40">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <div key={`${day}-${index}`} className="bg-muted/50 px-1 py-0.5 text-center text-[8px] text-muted-foreground">
            {day}
          </div>
        ))}
        {cells.map((day, index) => (
          <div key={index} className="min-h-16 bg-card p-1">
            {day ? (
              <>
                <div className="text-[8px] text-muted-foreground">{day}</div>
                <div className="mt-0.5 space-y-0.5">
                  {(rowsByDay.get(day) ?? []).map((row) => (
                    <div key={row.id} className="truncate rounded bg-saffron/15 px-1 py-0.5 text-[7px] text-foreground">
                      {cellValue(row, titleField?.id ?? "") || "Item"}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
