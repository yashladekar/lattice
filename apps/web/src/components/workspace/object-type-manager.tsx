"use client";

import {
  parsePropertyDefinitions,
  PROPERTY_TYPES,
  type PropertyType,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import {
  createObjectTypeLocal,
  deleteObjectTypeLocal,
  updateObjectTypeLocal,
} from "@/lib/local/repository";
import type { LocalObjectType } from "@/lib/local/types";

interface PropertyDraft {
  label: string;
  type: PropertyType;
  options: string;
}

const BLANK_DRAFT: PropertyDraft = { label: "", type: "text", options: "" };

export function ObjectTypeManager() {
  const { db, activeWorkspaceId, role } = useAppData();
  const types =
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        return db.objectTypes.where("workspaceId").equals(activeWorkspaceId).toArray();
      },
      [db, activeWorkspaceId],
      [],
    ) ?? [];
  const [editing, setEditing] = useState<LocalObjectType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("◈");
  const [color, setColor] = useState("#2f6b4f");
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<PropertyDraft[]>([{ ...BLANK_DRAFT }]);
  const [pendingDelete, setPendingDelete] = useState<LocalObjectType | null>(null);
  const canEdit = ["OWNER", "ADMIN", "MEMBER", "EDITOR"].includes(role ?? "");

  const openNew = () => {
    setEditing(null);
    setName("");
    setIcon("◈");
    setColor("#2f6b4f");
    setDescription("");
    setDrafts([{ ...BLANK_DRAFT }]);
    setDialogOpen(true);
  };

  const openEdit = (type: LocalObjectType) => {
    setEditing(type);
    setName(type.name);
    setIcon(type.icon ?? "◈");
    setColor(type.color);
    setDescription(type.description ?? "");
    setDrafts(
      type.properties.length
        ? type.properties.map((property) => ({
            label: property.label,
            type: property.type,
            options: (property.options ?? []).join(", "),
          }))
        : [{ ...BLANK_DRAFT }],
    );
    setDialogOpen(true);
  };

  const save = async () => {
    if (!db || !activeWorkspaceId) return;
    if (!name.trim()) {
      toast.error("Give the type a name.");
      return;
    }
    const properties = parsePropertyDefinitions(
      drafts
        .filter((draft) => draft.label.trim())
        .map((draft) => ({
          label: draft.label,
          type: draft.type,
          options:
            draft.type === "select"
              ? draft.options.split(",").map((option) => option.trim()).filter(Boolean)
              : undefined,
        })),
    );
    try {
      if (editing) {
        await updateObjectTypeLocal(db, editing.id, {
          name,
          icon,
          color,
          description: description || null,
          properties,
        });
      } else {
        await createObjectTypeLocal(db, {
          workspaceId: activeWorkspaceId,
          name,
          icon,
          color,
          description,
          properties,
        });
      }
      setDialogOpen(false);
      toast.success(editing ? "Type updated" : "Type created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the type");
    }
  };

  const remove = async (type: LocalObjectType) => {
    if (!db) return;
    await deleteObjectTypeLocal(db, type.id);
    toast.success("Type deleted");
  };

  const active = types.filter((type) => !type.deletedAt);

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium">Object types</h3>
          <Button
            size="sm"
            className="h-7 rounded-md text-[9px]"
            disabled={!canEdit}
            onClick={openNew}
          >
            <Plus className="size-3" /> New type
          </Button>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          Give pages a typed schema — a book, a project, a person — with fields that render in the
          page context panel. Values live in page properties, so they sync and export with the page.
        </p>
        <div className="mt-2 space-y-1">
          {active.length ? (
            active.map((type) => (
              <div
                key={type.id}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5"
              >
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-md text-[11px]"
                  style={{ backgroundColor: `${type.color}22`, color: type.color }}
                >
                  {type.icon ?? "◈"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-medium">{type.name}</div>
                  <div className="truncate text-[8px] text-muted-foreground">
                    {type.properties.map((property) => property.label).join(" · ") || "No fields yet"}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-md text-[8px]"
                  disabled={!canEdit}
                  onClick={() => openEdit(type)}
                >
                  Edit
                </Button>
                <button
                  type="button"
                  aria-label={`Delete ${type.name}`}
                  disabled={!canEdit}
                  onClick={() => setPendingDelete(type)}
                  className="grid size-7 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 tap-target"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))
          ) : (
            <p className="py-4 text-center text-[9px] text-muted-foreground">
              No object types yet. Create one to add typed fields to pages.
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this object type?"
        description={
          pendingDelete
            ? `“${pendingDelete.name}” stops rendering on pages. Stored values are kept and reappear as plain properties.`
            : ""
        }
        confirmLabel="Delete"
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const type = pendingDelete;
          setPendingDelete(null);
          if (type) await remove(type);
        }}
      />

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit object type" : "New object type"}
        description="Fields are stored as page properties and render as typed inputs."
        className="max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8" onClick={() => void save()}>
              {editing ? "Save type" : "Create type"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <label className="block w-14">
              <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                Icon
              </span>
              <input
                value={icon}
                onChange={(event) => setIcon(event.target.value.slice(0, 4))}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-center text-[13px] outline-none focus:border-primary/40"
              />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                Name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Book, Project, Person…"
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary/40"
              />
            </label>
            <label className="block w-16">
              <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                Color
              </span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-1 outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
              Description
            </span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this type represents"
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-[10px] outline-none focus:border-primary/40"
            />
          </label>

          <div className="pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                Fields
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 rounded-md text-[8px]"
                onClick={() => setDrafts((current) => [...current, { ...BLANK_DRAFT }])}
              >
                <Plus className="size-2.5" /> Add field
              </Button>
            </div>
            <div className="mt-1.5 space-y-1">
              {drafts.map((draft, index) => (
                <div key={index} className="rounded-md border border-border/60 bg-background/40 p-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={draft.label}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((entry, cursor) =>
                            cursor === index ? { ...entry, label: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="Field name"
                      className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[10px] outline-none focus:border-primary/40"
                    />
                    <select
                      value={draft.type}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((entry, cursor) =>
                            cursor === index
                              ? { ...entry, type: event.target.value as PropertyType }
                              : entry,
                          ),
                        )
                      }
                      className="h-7 rounded border border-border bg-background px-1 text-[9px]"
                    >
                      {PROPERTY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Remove field"
                      onClick={() =>
                        setDrafts((current) =>
                          current.length === 1
                            ? [{ ...BLANK_DRAFT }]
                            : current.filter((_, cursor) => cursor !== index),
                        )
                      }
                      className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive tap-target"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>
                  {draft.type === "select" ? (
                    <input
                      value={draft.options}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((entry, cursor) =>
                            cursor === index ? { ...entry, options: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="Options, comma separated"
                      className="mt-1 h-7 w-full rounded border border-border bg-background px-1.5 text-[9px] outline-none focus:border-primary/40"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
}
