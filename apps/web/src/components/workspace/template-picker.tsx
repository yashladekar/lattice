"use client";

import {
  PAGE_TEMPLATES,
  type PageTemplateDefinition,
  type TipTapDoc,
} from "@notes-learning/domain";
import { cn } from "@notes-learning/ui/lib/utils";
import { LayoutTemplate, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { useTemplates, useWorkspaceNotebooks } from "@/hooks/use-local-data";
import { createPageLocal, deleteTemplateLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  content: TipTapDoc;
  properties: Record<string, unknown>;
  custom: boolean;
}

function builtInOption(template: PageTemplateDefinition): TemplateOption {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
    category: template.category,
    content: template.content,
    properties: template.properties ?? {},
    custom: false,
  };
}

export function TemplatePickerDialog({
  open,
  onClose,
  notebookId,
}: {
  open: boolean;
  onClose: () => void;
  notebookId?: string | null;
}) {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const notebooks = useWorkspaceNotebooks();
  const custom = useTemplates();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const options = useMemo<TemplateOption[]>(() => {
    const saved: TemplateOption[] = custom.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      icon: template.icon ?? "◇",
      category: template.category || "Custom",
      content: template.content,
      properties: template.properties ?? {},
      custom: true,
    }));
    return [...saved, ...PAGE_TEMPLATES.map(builtInOption)];
  }, [custom]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      `${option.name} ${option.description} ${option.category}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [options, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, TemplateOption[]>();
    for (const option of filtered) {
      const key = option.custom ? "Your templates" : option.category;
      const list = groups.get(key) ?? [];
      list.push(option);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  const use = async (option: TemplateOption) => {
    if (!db || !user || !activeWorkspaceId) return;
    setBusyId(option.id);
    try {
      const created = await createPageLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        notebookId: notebookId ?? notebooks[0]?.id ?? null,
        title: option.name,
        icon: option.icon,
        content: option.content,
        properties: option.properties,
      });
      onClose();
      router.push(appRouteObject({ view: "page", id: created.page.id }));
      toast.success(`Created “${option.name}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the page");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (option: TemplateOption) => {
    if (!db || !option.custom) return;
    await deleteTemplateLocal(db, option.id);
    toast.success(`Removed “${option.name}”`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New page from a template"
      description="Start from a structure instead of a blank page."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter templates…"
            autoFocus
            className="h-9 flex-1 bg-transparent text-xs outline-none"
          />
        </div>

        {grouped.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No templates match “{query}”.
          </p>
        ) : (
          grouped.map(([group, list]) => (
            <div key={group}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {group}
                </span>
                {group === "Your templates" ? (
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                    custom
                  </span>
                ) : null}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {list.map((option) => (
                  <div
                    key={`${option.custom ? "custom" : "builtin"}-${option.id}`}
                    className={cn(
                      "group flex items-start gap-2.5 rounded-lg border border-border/70 bg-card/60 p-2.5 transition-colors hover:border-primary/40 hover:bg-card",
                      busyId === option.id && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void use(option)}
                      disabled={busyId !== null}
                      className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-sm">
                        {option.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {option.name}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </button>
                    {option.custom ? (
                      <button
                        type="button"
                        onClick={() => void remove(option)}
                        title="Delete template"
                        className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/40 transition-opacity hover:bg-destructive/10 hover:text-destructive hover-reveal tap-target"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2">
          <LayoutTemplate className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Save any page as a template from its actions menu. Custom templates stay in this
            workspace and sync with it.
          </p>
        </div>
      </div>
    </Modal>
  );
}
