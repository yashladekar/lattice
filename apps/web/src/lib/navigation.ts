import type { ReadonlyURLSearchParams } from "next/navigation";

export const APP_VIEWS = [
  "home",
  "page",
  "canvas",
  "graph",
  "inbox",
  "learn",
  "settings",
  "search",
  "timeline",
  "trash",
] as const;

export type AppView = (typeof APP_VIEWS)[number];

export interface AppRoute {
  view: AppView;
  id: string | null;
  notebook: string | null;
  query: string;
  pane: string | null;
  tab: string | null;
}

export function isAppView(value: string | null | undefined): value is AppView {
  return Boolean(value && (APP_VIEWS as readonly string[]).includes(value));
}

export function parseAppRoute(params: ReadonlyURLSearchParams): AppRoute {
  const view = params.get("view");
  return {
    view: isAppView(view) ? view : "home",
    id: params.get("id"),
    notebook: params.get("notebook"),
    query: params.get("q") ?? "",
    pane: params.get("pane"),
    tab: params.get("tab"),
  };
}

export function appHref(route: Partial<AppRoute> & { view: AppView }): string {
  const params = new URLSearchParams();
  params.set("view", route.view);
  if (route.id) params.set("id", route.id);
  if (route.notebook) params.set("notebook", route.notebook);
  if (route.query) params.set("q", route.query);
  if (route.pane) params.set("pane", route.pane);
  if (route.tab) params.set("tab", route.tab);
  return `/app?${params.toString()}`;
}

export function appRouteObject(
  route: Partial<AppRoute> & { view: AppView },
): string {
  return appHref(route);
}
