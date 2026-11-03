"use client";

import { pageBreadcrumbs } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronRight,
  Command,
  LogOut,
  Menu,
  MessageSquare,
  PanelRight,
  Share2,
  Sparkles,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useAppData } from "@/components/app-data-provider";
import { authClient } from "@/lib/auth-client";
import { useCanvas, useNotebook, usePage, useWorkspacePages } from "@/hooks/use-local-data";
import { appRouteObject, type AppRoute } from "@/lib/navigation";
import { client } from "@/utils/orpc";

import { ModeToggle } from "../mode-toggle";
import { SyncBadge } from "./sync-badge";

const VIEW_LABELS: Record<AppRoute["view"], string> = {
  home: "Home",
  page: "Page",
  canvas: "Canvas",
  graph: "Knowledge graph",
  inbox: "Inbox",
  learn: "Learning",
  settings: "Settings",
  search: "Search",
  timeline: "Timeline",
  trash: "Trash",
};

export function WorkspaceTopbar({
  route,
  onToggleSidebar,
  onOpenPalette,
  onOpenShare,
  onOpenAsk,
  onToggleRightPanel,
  rightPanelOpen,
  onOpenConflicts,
}: {
  route: AppRoute;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenShare: () => void;
  onOpenAsk: () => void;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  onOpenConflicts: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, activeWorkspace, role } = useAppData();
  const pages = useWorkspacePages();
  const page = usePage(route.view === "page" ? route.id : null);
  const canvas = useCanvas(route.view === "canvas" ? route.id : null);
  const notebook = useNotebook(page?.notebookId ?? null);
  const crumbs = page ? pageBreadcrumbs(page.id, pages) : [];

  const notifications = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => client.notification.list({ limit: 12 }),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const unread = useQuery({
    queryKey: ["notifications-unread", user?.id],
    queryFn: async () => client.notification.unreadCount(),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });

  const openNotification = async (notification: {
    id: string;
    href: string | null;
  }) => {
    await client.notification.markRead({ notificationId: notification.id });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] }),
    ]);
    if (notification.href) router.push(notification.href);
  };

  const signOut = async () => {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="size-4" />
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
          aria-label="Open command palette"
        >
          <Command className="size-4" />
        </button>

        <div className="flex min-w-0 items-center gap-1 text-[10.5px]">
          <button
            type="button"
            onClick={() => router.push(appRouteObject({ view: "home" }))}
            className="hidden shrink-0 text-muted-foreground hover:text-foreground sm:block"
          >
            {activeWorkspace?.name ?? "Lattice"}
          </button>
          {route.view !== "home" ? (
            <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/40 sm:block" />
          ) : null}
          {route.view === "page" ? (
            <>
              {notebook ? (
                <>
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">{notebook.name}</span>
                  <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/40 sm:inline" />
                </>
              ) : null}
              <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                {crumbs.slice(0, -1).map((crumb) => (
                  <button
                    key={crumb.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "page", id: crumb.id }))}
                    className="hidden max-w-28 truncate text-muted-foreground hover:text-foreground md:block"
                  >
                    {crumb.title}
                  </button>
                ))}
                {crumbs.length > 1 ? (
                  <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/40 md:block" />
                ) : null}
                <span className="truncate font-medium text-foreground">{page?.title ?? "Loading…"}</span>
              </div>
            </>
          ) : route.view === "canvas" ? (
            <span className="truncate font-medium text-foreground">{canvas?.title ?? "Canvas"}</span>
          ) : (
            <span className="font-medium text-foreground">{VIEW_LABELS[route.view]}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50 md:inline">
          {role ?? ""}
        </span>
        <SyncBadge onConflicts={onOpenConflicts} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative h-7 w-7 rounded-md text-muted-foreground"
                title="Notifications"
              />
            }
          >
            <Bell className="size-3.5" />
            {(unread.data ?? 0) > 0 ? (
              <span className="absolute right-0.5 top-0.5 grid min-w-3 place-items-center rounded-full bg-saffron px-0.5 text-[7px] font-semibold text-primary-foreground">
                {Math.min(9, unread.data ?? 0)}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.data?.length ? (
              notifications.data.slice(0, 6).map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() => void openNotification(notification)}
                  className="items-start gap-2 py-2"
                >
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      notification.readAt ? "bg-border" : "bg-saffron",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium leading-snug">
                      {notification.title}
                    </span>
                    {notification.body ? (
                      <span className="mt-0.5 line-clamp-2 block text-[8.5px] leading-snug text-muted-foreground">
                        {notification.body}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-[7.5px] text-muted-foreground/60">
                      {new Date(notification.createdAt).toLocaleString()}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-[9px] text-muted-foreground">
                No notifications yet.
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {route.view === "page" || route.view === "canvas" ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "h-7 w-7 rounded-md text-muted-foreground",
                rightPanelOpen && "bg-muted text-foreground",
              )}
              onClick={onToggleRightPanel}
              title="Page context"
            >
              <PanelRight className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 rounded-md text-muted-foreground"
              onClick={onOpenShare}
              title="Share"
            >
              <Share2 className="size-3.5" />
            </Button>
          </>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="hidden h-7 rounded-md border-border bg-card/60 px-2 text-[10px] text-muted-foreground hover:text-foreground sm:flex"
          onClick={onOpenAsk}
        >
          <Sparkles className="size-3 text-saffron" />
          Ask
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden h-7 w-7 rounded-md text-muted-foreground md:grid"
          onClick={onOpenPalette}
          title="Command palette (⌘K)"
        >
          <Command className="size-3.5" />
        </Button>
        <ModeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="grid size-7 place-items-center rounded-full bg-moss/15 text-[9px] font-semibold text-moss ring-1 ring-moss/20 transition-opacity hover:opacity-80"
                aria-label="Account menu"
              />
            }
          >
            {user?.name?.slice(0, 2).toUpperCase() ?? <User className="size-3" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="px-2 py-1.5">
              <div className="truncate text-[11px] font-medium text-foreground">{user?.name}</div>
              <div className="truncate text-[9px] font-normal text-muted-foreground">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(appRouteObject({ view: "settings" }))}>
              <User className="size-3.5" /> Account & workspace
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenAsk}>
              <MessageSquare className="size-3.5" /> Ask Lattice
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
              <LogOut className="size-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
